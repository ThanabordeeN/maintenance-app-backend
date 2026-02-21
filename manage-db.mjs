import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkData() {
    const client = await pool.connect();
    try {
        const manualLogs = await client.query(`
      SELECT equipment_id, usage_value, log_date, notes 
      FROM equipment_usage_logs 
      WHERE notes NOT LIKE 'Auto-%'
      ORDER BY equipment_id, log_date DESC
    `);
        console.log('Manual Logs:');
        console.table(manualLogs.rows);

        const equipments = await client.query(`
      SELECT equipment_id, equipment_name, current_usage 
      FROM equipment
      WHERE current_usage > 0
      ORDER BY equipment_id
    `);
        console.log('\nEquipment Current Usage:');
        console.table(equipments.rows);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
    }
}

async function dryRunFix() {
    const client = await pool.connect();
    try {
        const equipments = await client.query(`SELECT equipment_id, equipment_name, current_usage FROM equipment`);

        for (const eq of equipments.rows) {
            const firstLogRes = await client.query(`
        SELECT id, usage_value, log_date 
        FROM equipment_usage_logs 
        WHERE equipment_id = $1 AND notes LIKE 'Auto-%'
        ORDER BY id ASC LIMIT 1
      `, [eq.equipment_id]);

            if (firstLogRes.rows.length === 0) continue;

            const firstLog = firstLogRes.rows[0];

            const uptimeRes = await client.query(`
        SELECT EXTRACT(EPOCH FROM uptime)/3600.0 AS uptime_hrs
        FROM equipment_daily_summary
        WHERE equipment_id = $1 AND date = $2
      `, [eq.equipment_id, firstLog.log_date]);

            let firstUptime = 0;
            if (uptimeRes.rows.length > 0) {
                firstUptime = parseFloat(uptimeRes.rows[0].uptime_hrs);
            }

            const originalBase = parseFloat(firstLog.usage_value) - firstUptime;

            const totalUptimeRes = await client.query(`
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM uptime)/3600.0), 0) AS total_uptime
        FROM equipment_daily_summary
        WHERE equipment_id = $1
      `, [eq.equipment_id]);

            const correctTotalUptime = parseFloat(totalUptimeRes.rows[0].total_uptime);
            const correctCurrentUsage = originalBase + correctTotalUptime;

            console.log(`[${eq.equipment_name}]`);
            console.log(`  Current Usage (Bugged): ${eq.current_usage}`);
            console.log(`  First Auto Log Value: ${firstLog.usage_value} (on ${firstLog.log_date.toISOString().split('T')[0]})`);
            console.log(`  Uptime on that day: ${firstUptime.toFixed(2)}`);
            console.log(`  => Extracted Original Base: ${originalBase.toFixed(2)}`);
            console.log(`  Correct Total Uptime in Summary: ${correctTotalUptime.toFixed(2)}`);
            console.log(`  => CORRECT Current Usage should be: ${correctCurrentUsage.toFixed(2)}`);
            console.log('------------------------------------------------');
        }
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
    }
}

async function rebuildLogs() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('🛑 1. ปิด Trigger ชั่วคราว...');
        await client.query(`DROP TRIGGER IF EXISTS trg_sync_daily_summary_to_usage_logs ON equipment_daily_summary;`);

        const equipments = await client.query(`SELECT equipment_id, equipment_name, current_usage FROM equipment`);

        const eqBases = {};
        for (const eq of equipments.rows) {
            const firstLogRes = await client.query(`
        SELECT id, usage_value, log_date 
        FROM equipment_usage_logs 
        WHERE equipment_id = $1 AND notes LIKE 'Auto-%'
        ORDER BY id ASC LIMIT 1
      `, [eq.equipment_id]);

            let originalBase = 0;
            if (firstLogRes.rows.length > 0) {
                const firstLog = firstLogRes.rows[0];
                const uptimeRes = await client.query(`
          SELECT EXTRACT(EPOCH FROM uptime)/3600.0 AS uptime_hrs
          FROM equipment_daily_summary
          WHERE equipment_id = $1 AND date = $2
        `, [eq.equipment_id, firstLog.log_date]);

                let firstUptime = 0;
                if (uptimeRes.rows.length > 0) {
                    firstUptime = parseFloat(uptimeRes.rows[0].uptime_hrs);
                }

                originalBase = parseFloat(firstLog.usage_value) - firstUptime;
                if (originalBase < 0) originalBase = 0;
            }
            eqBases[eq.equipment_id] = originalBase;
        }

        console.log('🗑️ 2. ลบประวัติที่มีปัญหา (Auto-calculated) ออกทั้งหมด...');
        await client.query(`DELETE FROM equipment_usage_logs WHERE notes LIKE 'Auto-%';`);

        console.log('🔄 3. เริ่มคำนวณใหม่ไล่ตามวัน แบบไม่ซ้ำซ้อน...');
        for (const eq of equipments.rows) {
            let currentUsg = eqBases[eq.equipment_id];

            const summaries = await client.query(`
        SELECT date, EXTRACT(EPOCH FROM uptime)/3600.0 AS uptime_hrs
        FROM equipment_daily_summary
        WHERE equipment_id = $1
        ORDER BY date ASC
      `, [eq.equipment_id]);

            if (summaries.rows.length === 0) continue;

            for (const sum of summaries.rows) {
                const hrs = parseFloat(sum.uptime_hrs);
                if (hrs <= 0) continue;

                currentUsg += hrs;

                await client.query(`
          INSERT INTO equipment_usage_logs (equipment_id, usage_value, log_date, notes, condition, created_at, updated_at)
          VALUES ($1, $2, $3, 'Auto-calculated from sensor daily summary', 'normal', NOW(), NOW())
        `, [eq.equipment_id, currentUsg, sum.date]);
            }

            await client.query(`UPDATE equipment SET current_usage = $1 WHERE equipment_id = $2`, [currentUsg, eq.equipment_id]);
            console.log(`✅ [${eq.equipment_name}] Rebuilt! Final Usage = ${currentUsg.toFixed(2)}`);
        }

        console.log('⚙️ 4. เปิด Trigger กลับมาใช้งานตามปกติ...');
        await client.query(`
      CREATE TRIGGER trg_sync_daily_summary_to_usage_logs
      AFTER INSERT OR UPDATE ON equipment_daily_summary
      FOR EACH ROW EXECUTE FUNCTION trg_daily_summary_to_usage_log();
    `);

        await client.query('COMMIT');
        console.log('🎉 ซ่อมแซมข้อมูลเสร็จสิ้น สำเร็จทุกขั้นตอน!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', err);
    } finally {
        client.release();
    }
}

async function setup() {
    const client = await pool.connect();
    try {
        console.log('=========================================');
        console.log('1️⃣  PART 1: MIGRATE SENSORS & TRIGGERS');
        console.log('=========================================');

        console.log('\n🔍 Preview - sensors ที่ match กับ equipment:');
        const preview = await client.query(`
      SELECT s.sensor_id, s.sensor_code, s.equipment_id AS current_id,
             e.equipment_id AS new_id, e.equipment_name
      FROM sensors s
      JOIN equipment e ON s.sensor_code = e.equipment_code
      ORDER BY s.sensor_id
    `);
        const total = await client.query('SELECT COUNT(*) FROM sensors');
        if (preview.rows.length > 0) console.table(preview.rows);
        console.log(`✅ match ${preview.rows.length}/${total.rows[0].count} sensors (ที่เหลือจะได้ NULL)\n`);

        const result = await client.query(`
      UPDATE sensors
      SET equipment_id = (
        SELECT e.equipment_id
        FROM equipment e
        WHERE e.equipment_code = sensors.sensor_code
        LIMIT 1
      )
    `);
        console.log(`🎉 UPDATE สำเร็จ! ${result.rowCount} rows updated\n`);

        console.log('⚙️  สร้าง Function + Trigger บน sensors...');
        await client.query(`
      CREATE OR REPLACE FUNCTION auto_link_sensor_equipment()
      RETURNS TRIGGER AS $$
      BEGIN
        SELECT equipment_id INTO NEW.equipment_id
        FROM equipment
        WHERE equipment_code = NEW.sensor_code
        LIMIT 1;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS trg_auto_link_sensor_equipment ON sensors;
      CREATE TRIGGER trg_auto_link_sensor_equipment
      BEFORE INSERT OR UPDATE OF sensor_code ON sensors
      FOR EACH ROW
      EXECUTE FUNCTION auto_link_sensor_equipment();
    `);
        console.log('✅ Trigger "trg_auto_link_sensor_equipment" on sensors created\n');

        console.log('⚙️  สร้าง Function + Trigger บน equipment...');
        await client.query(`
      CREATE OR REPLACE FUNCTION sync_sensors_on_equipment_code_change()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE sensors
        SET equipment_id = NEW.equipment_id
        WHERE sensor_code = NEW.equipment_code;

        UPDATE sensors
        SET equipment_id = NULL
        WHERE equipment_id = NEW.equipment_id
          AND sensor_code != NEW.equipment_code;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS trg_sync_sensors_on_equipment_code_change ON equipment;
      CREATE TRIGGER trg_sync_sensors_on_equipment_code_change
      AFTER UPDATE OF equipment_code ON equipment
      FOR EACH ROW
      EXECUTE FUNCTION sync_sensors_on_equipment_code_change();
    `);
        console.log('✅ Trigger "trg_sync_sensors_on_equipment_code_change" on equipment created\n');


        console.log('=========================================');
        console.log('2️⃣  PART 2: DAILY SUMMARY TABLE & FUNCTION');
        console.log('=========================================');

        console.log('\n⚙️  Dropping old equipment_daily_summary table (if exists)...');
        await client.query(`DROP TABLE IF EXISTS equipment_daily_summary CASCADE`);

        console.log('⚙️  Creating new table (with equipment_id)...');
        await client.query(`
      CREATE TABLE equipment_daily_summary (
        date          DATE    NOT NULL,
        sensor_id     INTEGER NOT NULL REFERENCES sensors(sensor_id),
        equipment_id  INTEGER,
        uptime        INTERVAL,
        downtime      INTERVAL,
        avg_current   FLOAT,
        max_current   FLOAT,
        min_current   FLOAT,
        PRIMARY KEY (date, sensor_id)
      )
    `);
        console.log('✅ New table created\n');

        console.log('⚙️  Creating function compute_daily_summary...');
        await client.query(`
      CREATE OR REPLACE FUNCTION compute_daily_summary(target_date DATE)
      RETURNS INTEGER AS $$
      DECLARE
        rows_upserted INTEGER;
      BEGIN
        WITH daily_bounds AS (
          SELECT
            ct.sensor_id,
            s.equipment_id,
            DATE(ct.time AT TIME ZONE 'Asia/Bangkok') AS day,
            MIN(CASE WHEN ct.current_value > 0 THEN ct.time END) AS first_active,
            MAX(CASE WHEN ct.current_value > 0 THEN ct.time END) AS last_active,
            AVG(ct.current_value) FILTER (WHERE ct.current_value > 0) AS avg_current,
            MAX(ct.current_value)                                      AS max_current,
            MIN(ct.current_value) FILTER (WHERE ct.current_value > 0) AS min_current
          FROM ct_sensor_data ct
          LEFT JOIN sensors s ON ct.sensor_id = s.sensor_id
          WHERE DATE(ct.time AT TIME ZONE 'Asia/Bangkok') = target_date
          GROUP BY ct.sensor_id, s.equipment_id, DATE(ct.time AT TIME ZONE 'Asia/Bangkok')
        ),
        with_next AS (
          SELECT
            c.sensor_id,
            DATE(c.time AT TIME ZONE 'Asia/Bangkok') AS day,
            c.time,
            c.current_value,
            LEAD(c.time) OVER (
              PARTITION BY c.sensor_id, DATE(c.time AT TIME ZONE 'Asia/Bangkok')
              ORDER BY c.time
            ) AS next_time
          FROM ct_sensor_data c
          WHERE DATE(c.time AT TIME ZONE 'Asia/Bangkok') = target_date
        ),
        downtime_calc AS (
          SELECT
            w.sensor_id,
            w.day,
            COALESCE(
              SUM(EXTRACT(EPOCH FROM (w.next_time - w.time))), 0
            ) AS downtime_sec
          FROM with_next w
          JOIN daily_bounds b ON w.sensor_id = b.sensor_id AND w.day = b.day
          WHERE w.current_value = 0
            AND w.next_time IS NOT NULL
            AND w.time      >= b.first_active
            AND w.next_time <= b.last_active
          GROUP BY w.sensor_id, w.day
        )
        INSERT INTO equipment_daily_summary
          (date, sensor_id, equipment_id, uptime, downtime, avg_current, max_current, min_current)
        SELECT
          b.day,
          b.sensor_id,
          b.equipment_id,
          (b.last_active - b.first_active)                    AS uptime,
          make_interval(secs => COALESCE(d.downtime_sec, 0))  AS downtime,
          b.avg_current,
          b.max_current,
          b.min_current
        FROM daily_bounds b
        LEFT JOIN downtime_calc d ON b.sensor_id = d.sensor_id AND b.day = d.day
        WHERE b.first_active IS NOT NULL
        ON CONFLICT (date, sensor_id) DO UPDATE SET
          equipment_id = EXCLUDED.equipment_id,
          uptime       = EXCLUDED.uptime,
          downtime     = EXCLUDED.downtime,
          avg_current  = EXCLUDED.avg_current,
          max_current  = EXCLUDED.max_current,
          min_current  = EXCLUDED.min_current;

        GET DIAGNOSTICS rows_upserted = ROW_COUNT;
        RETURN rows_upserted;
      END;
      $$ LANGUAGE plpgsql;
    `);
        console.log('✅ Function compute_daily_summary created\n');

        console.log('=========================================');
        console.log('2.5️⃣  PART 2.5: DAILY SUMMARY TO USAGE LOGS TRIGGER');
        console.log('=========================================');

        console.log('⚙️  Creating Function "trg_daily_summary_to_usage_log"...');
        await client.query(`
          CREATE OR REPLACE FUNCTION trg_daily_summary_to_usage_log()
          RETURNS TRIGGER AS $$
          DECLARE
            uptime_hours NUMERIC;
            diff_hours NUMERIC;
          BEGIN
            IF NEW.equipment_id IS NULL THEN
              RETURN NEW;
            END IF;

            IF NEW.uptime IS NOT NULL THEN
              uptime_hours := EXTRACT(EPOCH FROM NEW.uptime) / 3600.0;
            ELSE
              uptime_hours := 0;
            END IF;

            IF uptime_hours <= 0 THEN
              RETURN NEW;
            END IF;

            IF TG_OP = 'INSERT' THEN
              UPDATE equipment 
              SET current_usage = COALESCE(current_usage, 0) + uptime_hours, 
                  updated_at = NOW()
              WHERE equipment_id = NEW.equipment_id;

              INSERT INTO equipment_usage_logs (
                equipment_id, usage_value, log_date, notes, condition, created_at, updated_at
              ) VALUES (
                NEW.equipment_id, 
                (SELECT current_usage FROM equipment WHERE equipment_id = NEW.equipment_id LIMIT 1),
                NEW.date, 
                'Auto-calculated from sensor daily summary', 
                'normal', NOW(), NOW()
              );

            ELSIF TG_OP = 'UPDATE' THEN
              IF OLD.uptime IS NOT NULL THEN
                diff_hours := uptime_hours - (EXTRACT(EPOCH FROM OLD.uptime) / 3600.0);
              ELSE
                diff_hours := uptime_hours - 0;
              END IF;
              
              IF diff_hours != 0 THEN
                UPDATE equipment 
                SET current_usage = COALESCE(current_usage, 0) + diff_hours, 
                    updated_at = NOW()
                WHERE equipment_id = NEW.equipment_id;

                UPDATE equipment_usage_logs
                SET usage_value = (SELECT current_usage FROM equipment WHERE equipment_id = NEW.equipment_id LIMIT 1),
                    notes = 'Auto-recalculated from sensor daily summary',
                    updated_at = NOW()
                WHERE equipment_id = NEW.equipment_id 
                  AND log_date = NEW.date 
                  AND notes LIKE 'Auto-%';
                
                IF NOT FOUND THEN
                   INSERT INTO equipment_usage_logs (
                    equipment_id, usage_value, log_date, notes, condition, created_at, updated_at
                  ) VALUES (
                    NEW.equipment_id, 
                    (SELECT current_usage FROM equipment WHERE equipment_id = NEW.equipment_id LIMIT 1),
                    NEW.date, 
                    'Auto-recalculated from sensor daily summary', 
                    'normal', NOW(), NOW()
                  );
                END IF;
              END IF;
            END IF;
            
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Function trg_daily_summary_to_usage_log created\n');

        console.log('⚙️  Attaching Trigger to "equipment_daily_summary"...');
        await client.query(`
          DROP TRIGGER IF EXISTS trg_sync_daily_summary_to_usage_logs ON equipment_daily_summary;
          CREATE TRIGGER trg_sync_daily_summary_to_usage_logs
          AFTER INSERT OR UPDATE ON equipment_daily_summary
          FOR EACH ROW EXECUTE FUNCTION trg_daily_summary_to_usage_log();
        `);
        console.log('✅ Trigger trg_sync_daily_summary_to_usage_logs attached\n');


        console.log('=========================================');
        console.log('3️⃣  PART 3: BACKFILL DAILY SUMMARY DATA');
        console.log('=========================================');

        console.log('\n🔍 กำลังค้นหาวันที่มีข้อมูลใน ct_sensor_data...');
        const { rows: dates } = await client.query(`
      SELECT DISTINCT DATE(time AT TIME ZONE 'Asia/Bangkok') AS day
      FROM ct_sensor_data
      ORDER BY day ASC
    `);
        console.log(`📅 พบ ${dates.length} วัน ที่ต้อง compute\n`);

        let totalUpserted = 0;
        for (const { day } of dates) {
            if (!day) continue;
            const dayStr = day.toISOString().slice(0, 10);
            const { rows } = await client.query(
                'SELECT compute_daily_summary($1::DATE) AS upserted', [dayStr]
            );
            const n = rows[0].upserted;
            totalUpserted += n;
            console.log(`  ✅ ${dayStr}  → ${n} sensors upserted`);
        }
        console.log(`\n🎉 Backfill เสร็จสิ้น! รวม ${totalUpserted} rows upserted\n`);

        console.log('=========================================');
        console.log('🚀 ALL SETUP COMPLETED SUCCESSFULLY!');
        console.log('=========================================');

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err);
    } finally {
        client.release();
    }
}

async function main() {
    const action = process.argv[2];

    if (action === 'check') {
        console.log('--- RUNNING CHECK DATA ---');
        await checkData();
    } else if (action === 'dryrun') {
        console.log('--- RUNNING DRYRUN FIX ---');
        await dryRunFix();
    } else if (action === 'rebuild') {
        console.log('--- RUNNING REBUILD LOGS ---');
        await rebuildLogs();
    } else if (action === 'setup') {
        console.log('--- RUNNING SETUP ---');
        await setup();
    } else {
        console.log('Usage: node manage-db.mjs [check|dryrun|rebuild|setup]');
    }
}

main().catch(console.error).finally(() => pool.end());
