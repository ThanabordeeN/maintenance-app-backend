import { useState, useEffect } from 'react';
import { CheckCircle2, Clock, AlertCircle, Wrench, List, PackageSearch, ChevronRight, Filter, XCircle, Pause } from 'lucide-react';
import { maintenanceAPI } from '../services/api';
import { formatThaiDate } from '../lib/utils';
import MaintenanceDetail from './MaintenanceDetail';
import useLiff from '../hooks/useLiff';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';

const MaintenanceList = () => {
  const { profile } = useLiff();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedRecordId, setSelectedRecordId] = useState(null);

  const getRelativeTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'เมื่อสักครู่';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} นาทีที่แล้ว`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ชั่วโมงที่แล้ว`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} วันที่แล้ว`;

    return formatThaiDate(dateString);
  };

  useEffect(() => {
    fetchRecords();
  }, [filter]);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const statusFilter = filter === 'all' ? null : filter;
      const data = await maintenanceAPI.getAll(statusFilter);
      setRecords(Array.isArray(data) ? data : data.records || []);
    } catch (error) {
      console.error('Error fetching records:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { icon: Clock, variant: 'warning', label: 'รอดำเนินการ' },
      in_progress: { icon: Wrench, variant: 'info', label: 'กำลังซ่อม' },
      completed: { icon: CheckCircle2, variant: 'default', label: 'เสร็จสิ้น' },
      cancelled: { icon: XCircle, variant: 'destructive', label: 'ยกเลิก' },
      on_hold: { icon: Pause, variant: 'warning', label: 'พักงาน' }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="gap-1.5 py-1 px-3">
        <Icon size={12} />
        {config.label}
      </Badge>
    );
  };

  const getSourceBadge = (record) => {
    const isSystem = record.maintenance_type === 'inspection';
    return (
      <Badge variant="outline" className={`text-[10px] font-bold ${isSystem
        ? 'border-blue-500/30 text-blue-400 bg-blue-500/5'
        : 'border-purple-500/30 text-purple-400 bg-purple-500/5'
        }`}>
        {isSystem ? 'System' : 'Technician'}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-500 mx-auto"></div>
        <p className="mt-4 text-gray-500 font-medium">กำลังโหลดรายการแจ้งซ่อม...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Section */}
      <div className="sticky top-24 z-30 bg-gray-950/80 backdrop-blur-sm pb-4 pt-2 -mx-2 px-2 sm:mx-0 sm:px-0">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Filter className="h-5 w-5 text-green-500" />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="block w-full pl-10 pr-10 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white appearance-none focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 transition-all font-medium shadow-lg"
          >
            <option value="all">รายการทั้งหมด</option>
            <option value="pending">รอดำเนินการ</option>
            <option value="in_progress">กำลังซ่อม</option>
            <option value="completed">เสร็จสิ้น</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <ChevronRight className="h-5 w-5 text-gray-500 rotate-90" />
          </div>
        </div>
      </div>

      {/* List Feed */}
      <div className="space-y-4 px-2 sm:px-0">
        {records.length === 0 ? (
          <Card className="p-16 text-center bg-gray-950/50 border-dashed border-gray-800">
            <div className="bg-gray-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-700">
              <PackageSearch className="w-8 h-8" />
            </div>
            <CardTitle className="text-gray-600">ไม่มีรายการข้อมูล</CardTitle>
            <p className="text-gray-500 text-sm mt-1">ยังไม่มีการบันทึกข้อมูลในหมวดหมู่นี้</p>
          </Card>
        ) : (
          records.map((record) => (
            <Card
              key={record.id}
              className="group hover:border-gray-700 hover:bg-gray-900/40 transition-all cursor-pointer border-gray-800 rounded-2xl"
              onClick={() => setSelectedRecordId(record.id)}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <h3 className="font-bold text-white text-base sm:text-lg group-hover:text-green-400 transition-colors">
                        {record.equipment_name}
                      </h3>
                      <Badge variant="outline" className="text-gray-500 bg-transparent border-gray-800">
                        {record.equipment_code}
                      </Badge>
                    </div>
                    {record.title && (
                      <p className="text-green-400 font-semibold text-sm">
                        📋 {record.title}
                      </p>
                    )}
                    <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">
                      {record.description || record.notes || 'ไม่มีรายละเอียดการบันทึก'}
                    </p>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2">
                    {getStatusBadge(record.status)}
                    <span className="text-[10px] text-gray-500 font-mono sm:mt-1">{record.work_order}</span>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-500 flex items-center gap-1.5">
                      <Clock size={12} className="text-gray-600" />
                      {getRelativeTime(record.created_at)}
                    </div>
                    {getSourceBadge(record)}
                  </div>
                  <div className="text-xs font-semibold text-green-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    View Details
                    <ChevronRight size={14} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Detail Modal Layer */}
      {selectedRecordId && profile && (
        <MaintenanceDetail
          recordId={selectedRecordId}
          userId={profile.userId}
          onClose={() => {
            setSelectedRecordId(null);
            fetchRecords(); // Refresh list when closing detail to reflect any status changes
          }}
        />
      )}
    </div>
  );
};

export default MaintenanceList;
