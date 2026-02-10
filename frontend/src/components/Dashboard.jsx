import { useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  Wrench,
  DollarSign,
  TrendingUp,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Package,
  Timer,
  Gauge,
  ArrowLeft,
  RefreshCw
} from 'lucide-react';
import { reportsAPI } from '../services/api';
import { formatThaiDate } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';
import SimpleBarChart from './ui/SimpleBarChart';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [mtbf, setMtbf] = useState(null);
  const [mttr, setMttr] = useState(null);
  const [oee, setOee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [summaryRes, mtbfRes, mttrRes, oeeRes] = await Promise.all([
        reportsAPI.getSummary(startDate, endDate),
        reportsAPI.getMTBF(startDate, endDate),
        reportsAPI.getMTTR(startDate, endDate),
        reportsAPI.getOEE(startDate, endDate)
      ]);

      // Map API response to expected format
      const summaryData = {
        total: parseInt(summaryRes.workOrders?.total) || 0,
        pending: parseInt(summaryRes.workOrders?.pending) || 0,
        in_progress: parseInt(summaryRes.workOrders?.in_progress) || 0,
        completed: parseInt(summaryRes.workOrders?.completed) || 0,
        cancelled: parseInt(summaryRes.workOrders?.cancelled) || 0,
        on_hold: parseInt(summaryRes.workOrders?.on_hold) || 0,
        total_cost: parseFloat(summaryRes.costs?.total_cost) || 0,
        labor_cost: parseFloat(summaryRes.costs?.total_labor_cost) || 0,
        parts_cost: parseFloat(summaryRes.costs?.total_parts_cost) || 0,
        total_downtime: parseFloat(summaryRes.downtime?.total_downtime_hours) || 0,
        byType: summaryRes.byType || [],
        topEquipment: summaryRes.topEquipment || [],
        monthlyTrend: summaryRes.monthlyTrend || []
      };

      setSummary(summaryData);
      setMtbf(mtbfRes.mtbf || mtbfRes || {});
      setMttr(mttrRes.mttr || mttrRes || {});
      setOee(oeeRes.oee || oeeRes || {});
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '-';
    if (num % 1 !== 0) return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(num);
    return new Intl.NumberFormat('th-TH').format(num);
  };

  const formatCurrency = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '฿0';
    return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(num);
  };

  // Prepare chart data
  const trendData = (summary?.monthlyTrend || []).map(item => ({
    label: formatThaiDate(item.month).split(' ')[1], // Get only Month name
    value: item.count,
    color: 'bg-green-500'
  })).slice(-6); // Show last 6 months max

  if (loading) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-500 mx-auto"></div>
        <p className="mt-4 text-gray-500 font-medium">กำลังโหลด Dashboard...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-800 pb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-green-500" />
              Dashboard
            </h1>
            <p className="text-gray-400 mt-1">ภาพรวมระบบซ่อมบำรุง</p>
          </div>
        </div>

        {/* Period Filter */}
        <Card className="p-2 bg-gray-900/50 border-gray-800 self-start sm:self-auto overflow-x-auto max-w-full">
          <div className="flex gap-2 min-w-max">
            {[
              { value: 7, label: '7 วัน' },
              { value: 30, label: '30 วัน' },
              { value: 90, label: '90 วัน' },
              { value: 365, label: '1 ปี' }
            ].map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPeriod(p.value)}
                className={period === p.value ? 'bg-green-600 hover:bg-green-500' : ''}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* MTBF */}
        <Card className="bg-gray-900/50 border-gray-800 hover:border-blue-500/50 transition-colors">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Timer className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
              </div>
              <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5">MTBF</Badge>
            </div>
            <div className="mt-3">
              <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(mtbf?.average_hours || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">ชม. (เฉลี่ยระหว่างเสีย)</p>
            </div>
          </CardContent>
        </Card>

        {/* MTTR */}
        <Card className="bg-gray-900/50 border-gray-800 hover:border-amber-500/50 transition-colors">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Wrench className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
              </div>
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">MTTR</Badge>
            </div>
            <div className="mt-3">
              <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(mttr?.average_hours || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">ชม. (เฉลี่ยซ่อม)</p>
            </div>
          </CardContent>
        </Card>

        {/* Availability */}
        <Card className="bg-gray-900/50 border-gray-800 hover:border-green-500/50 transition-colors">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Gauge className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
              </div>
              <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 bg-green-500/5">Avail.</Badge>
            </div>
            <div className="mt-3">
              <p className="text-xl sm:text-2xl font-bold text-white">{formatNumber(oee?.availability || 0)}%</p>
              <p className="text-xs text-gray-500 mt-1">ความพร้อมใช้งาน</p>
            </div>
          </CardContent>
        </Card>

        {/* Total Cost */}
        <Card className="bg-gray-900/50 border-gray-800 hover:border-purple-500/50 transition-colors">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
              </div>
              <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-400 bg-purple-500/5">Cost</Badge>
            </div>
            <div className="mt-3">
              <p className="text-xl sm:text-2xl font-bold text-white truncate" title={formatCurrency(summary?.total_cost || 0)}>
                {formatCurrency(summary?.total_cost || 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1">ค่าใช้จ่ายรวม</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Trends & Summary */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* Monthly Trend Chart */}
        <Card className="border-gray-800 bg-gray-900/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-green-500" />
              แนวโน้มงานซ่อมบำรุง
            </CardTitle>
            <CardDescription>จำนวนใบงานย้อนหลัง 6 เดือน</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mt-2">
              <SimpleBarChart data={trendData} height={220} />
            </div>
          </CardContent>
        </Card>

        {/* Work Order Summary */}
        <Card className="border-gray-800 bg-gray-900/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="w-5 h-5 text-blue-500" />
              สถานะใบงาน
            </CardTitle>
            <CardDescription>สรุปสถานะในช่วง {period} วันล่าสุด</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'รอดำเนินการ', value: summary?.pending || 0, color: 'text-yellow-400', bg: 'bg-yellow-500', icon: Clock },
                { label: 'กำลังซ่อม', value: summary?.in_progress || 0, color: 'text-blue-400', bg: 'bg-blue-500', icon: Wrench },
                { label: 'เสร็จสิ้น', value: summary?.completed || 0, color: 'text-green-400', bg: 'bg-green-500', icon: CheckCircle2 },
                { label: 'ยกเลิก', value: summary?.cancelled || 0, color: 'text-red-400', bg: 'bg-red-500', icon: AlertTriangle }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex flex-col p-3 bg-gray-900/60 rounded-xl border border-gray-800/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`w-4 h-4 ${item.color}`} />
                      <span className="text-xs text-gray-400">{item.label}</span>
                    </div>
                    <span className={`text-2xl font-bold ${item.color}`}>{item.value}</span>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-gray-800 flex items-center justify-between px-2">
              <span className="text-gray-300 font-medium">รวมทั้งหมด</span>
              <span className="text-3xl font-bold text-white">{summary?.total || 0} ใบงาน</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Equipment by Maintenance */}
        <Card className="border-gray-800 bg-gray-900/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Top 5 อุปกรณ์ที่ซ่อมบ่อย
            </CardTitle>
            <CardDescription>เครื่องจักรที่มีการแจ้งซ่อมมากที่สุด</CardDescription>
          </CardHeader>
          <CardContent>
            {summary?.topEquipment?.length > 0 ? (
              <div className="space-y-3">
                {summary.topEquipment.slice(0, 5).map((eq, index) => (
                  <div key={eq.id || index} className="flex items-center gap-4 p-3 bg-gray-900/40 rounded-xl border border-gray-800/50">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                      index === 1 ? 'bg-gray-400/20 text-gray-400' :
                        index === 2 ? 'bg-amber-600/20 text-amber-600' :
                          'bg-gray-800 text-gray-500'
                      }`}>
                      #{index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate text-sm">{eq.equipment_name || eq.equipment_code}</p>
                      <p className="text-xs text-gray-500 truncate">{eq.location || 'ไม่ระบุตำแหน่ง'}</p>
                    </div>
                    <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/5 whitespace-nowrap">
                      {eq.maintenance_count || eq.count} ครั้ง
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Package className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="font-medium">ไม่มีข้อมูลการซ่อมในช่วงนี้</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Downtime & Cost Summary */}
        <Card className="border-gray-800 bg-gray-900/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="w-5 h-5 text-amber-500" />
              เวลาหยุดทำงาน & ต้นทุน
            </CardTitle>
            <CardDescription>ภาพรวมความสูญเสีย</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-xl border border-gray-800 margin-b-4">
              <div>
                <p className="text-gray-400 text-sm mb-1">Downtime รวม</p>
                <p className="text-3xl font-bold text-white">{formatNumber(summary?.total_downtime || 0)} <span className="text-sm font-normal text-gray-500">ชม.</span></p>
              </div>
              <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                <p className="text-xs text-gray-500 mb-1">ค่าอะไหล่</p>
                <p className="text-lg font-bold text-blue-400">{formatCurrency(summary?.parts_cost || 0)}</p>
              </div>
              <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                <p className="text-xs text-gray-500 mb-1">ค่าแรง</p>
                <p className="text-lg font-bold text-purple-400">{formatCurrency(summary?.labor_cost || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
