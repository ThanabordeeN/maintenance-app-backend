import { X, Clock, Wrench, CheckCircle, Play, Pause, XCircle, RotateCcw, Package, TrendingUp, History, MapPin, Camera, ClipboardCheck, ChevronDown, ChevronUp, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { maintenanceAPI, getImageUrl } from '../services/api';
import { formatThaiDateTime } from '../lib/utils';
import ProgressUpdateModal from './ProgressUpdateModal';


const MaintenanceDetail = ({ recordId, onClose, userId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState(null); // 'complete', 'start', 'hold', 'cancel', 'update', 'checklist'
  const [updateNotes, setUpdateNotes] = useState('');
  const [updateImages, setUpdateImages] = useState([]);
  const [updateImagePreviews, setUpdateImagePreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    equipment: false,
    history: false,
    images: false
  });

  // Form data for complete job
  const [completeForm, setCompleteForm] = useState({ rootCause: '', actionTaken: '' });
  const [holdReason, setHoldReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  useEffect(() => {
    fetchRecordDetail();
  }, [recordId]);

  const fetchRecordDetail = async () => {
    try {
      setLoading(true);
      const result = await maintenanceAPI.getById(recordId);
      setData(result);
    } catch (error) {
      console.error('Error fetching record detail:', error);
    } finally {
      setLoading(false);
    }
  };

  // Direct status update handlers
  const handleStartJob = async () => {
    if (isSubmitting) return; // Prevent double submit
    setIsSubmitting(true);
    try {
      await maintenanceAPI.update(recordId, { status: 'in_progress', userId });
      await fetchRecordDetail();
      setActiveModal(null);
    } catch (error) {
      alert('ไม่สามารถเริ่มงานได้: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteJob = async () => {
    if (isSubmitting) return; // Prevent double submit
    if (!completeForm.rootCause.trim() || !completeForm.actionTaken.trim()) {
      alert('กรุณากรอกสาเหตุและวิธีแก้ไข');
      return;
    }
    setIsSubmitting(true);
    try {
      await maintenanceAPI.update(recordId, {
        status: 'completed',
        userId,
        rootCause: completeForm.rootCause,
        actionTaken: completeForm.actionTaken
      });
      await fetchRecordDetail();
      setActiveModal(null);
      setCompleteForm({ rootCause: '', actionTaken: '' });
    } catch (error) {
      alert('ไม่สามารถปิดงานได้: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHoldJob = async () => {
    if (isSubmitting) return; // Prevent double submit
    if (!holdReason.trim()) {
      alert('กรุณาระบุเหตุผล');
      return;
    }
    setIsSubmitting(true);
    try {
      await maintenanceAPI.update(recordId, {
        status: 'on_hold',
        userId,
        onHoldReason: holdReason
      });
      await fetchRecordDetail();
      setActiveModal(null);
      setHoldReason('');
    } catch (error) {
      alert('ไม่สามารถพักงานได้: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async () => {
    if (isSubmitting) return; // Prevent double submit
    if (!cancelReason.trim()) {
      alert('กรุณาระบุเหตุผล');
      return;
    }
    setIsSubmitting(true);
    try {
      await maintenanceAPI.update(recordId, {
        status: 'cancelled',
        userId,
        cancelledReason: cancelReason
      });
      await fetchRecordDetail();
      setActiveModal(null);
      setCancelReason('');
    } catch (error) {
      alert('ไม่สามารถยกเลิกได้: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumeJob = async () => {
    if (isSubmitting) return; // Prevent double submit
    setIsSubmitting(true);
    try {
      await maintenanceAPI.update(recordId, { status: 'in_progress', userId });
      await fetchRecordDetail();
      setActiveModal(null);
    } catch (error) {
      alert('ไม่สามารถทำงานต่อได้: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProgressUpdate = async () => {
    if (isSubmitting) return; // Prevent double submit
    if (!updateNotes.trim()) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('notes', updateNotes);
      formData.append('userId', userId);
      updateImages.forEach(img => formData.append('images', img));

      await maintenanceAPI.addProgressUpdate(recordId, formData);
      await fetchRecordDetail();
      setActiveModal(null);
      setUpdateNotes('');
      setUpdateImages([]);
      setUpdateImagePreviews([]);
    } catch (error) {
      alert('ไม่สามารถบันทึกได้');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getStatusConfig = (status) => {
    const configs = {
      pending: { bg: 'bg-amber-500', text: 'text-amber-500', label: 'รอดำเนินการ', icon: Clock },
      in_progress: { bg: 'bg-sky-500', text: 'text-sky-500', label: 'กำลังซ่อม', icon: Wrench },
      completed: { bg: 'bg-emerald-500', text: 'text-emerald-500', label: 'เสร็จสิ้น', icon: CheckCircle },
      cancelled: { bg: 'bg-red-500', text: 'text-red-500', label: 'ยกเลิก', icon: XCircle },
      on_hold: { bg: 'bg-orange-500', text: 'text-orange-500', label: 'พักงาน', icon: Pause },
      reopened: { bg: 'bg-violet-500', text: 'text-violet-500', label: 'เปิดใหม่', icon: RotateCcw },
      // Timeline statuses for PR/PO workflow
      progress_update: { bg: 'bg-blue-500', text: 'text-blue-500', label: 'อัปเดตความคืบหน้า', icon: TrendingUp },
      parts_request: { bg: 'bg-purple-500', text: 'text-purple-500', label: 'ขอเบิกอะไหล่', icon: Package },
      parts_return: { bg: 'bg-teal-500', text: 'text-teal-500', label: 'คืนอะไหล่', icon: Package },
      pr_approved: { bg: 'bg-emerald-500', text: 'text-emerald-500', label: 'อนุมัติใบขอเบิก', icon: CheckCircle },
      pr_rejected: { bg: 'bg-red-500', text: 'text-red-500', label: 'ปฏิเสธใบขอเบิก', icon: XCircle },
      po_approved: { bg: 'bg-emerald-500', text: 'text-emerald-500', label: 'อนุมัติใบสั่งซื้อ', icon: CheckCircle },
      po_received: { bg: 'bg-emerald-600', text: 'text-emerald-600', label: 'รับอะไหล่แล้ว', icon: CheckCircle }
    };
    return configs[status] || configs.pending;
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    if (diffInSeconds < 60) return 'เมื่อสักครู่';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} นาทีที่แล้ว`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ชั่วโมงที่แล้ว`;
    return formatThaiDateTime(dateString);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
          <p className="mt-4 text-zinc-400">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (!data || !data.record) return null;

  const record = data.record;
  const timeline = data.timeline || [];
  const images = data.images || [];
  const statusConfig = getStatusConfig(record.status);
  const StatusIcon = statusConfig.icon;

  const getRepairTime = () => {
    if (record.downtime_minutes) {
      const hours = Math.floor(record.downtime_minutes / 60);
      const mins = record.downtime_minutes % 60;
      return hours > 0 ? `${hours} ชม. ${mins} นาที` : `${mins} นาที`;
    }
    return null;
  };

  const repairTime = getRepairTime();

  // ================== MODALS ==================

  // Start Job Confirmation
  if (activeModal === 'start') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModal(null)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <p className="text-white font-bold">เริ่มงานซ่อม</p>
          </div>
        </header>
        <main className="flex-1 p-6 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-emerald-600 flex items-center justify-center mb-6">
            <Play size={40} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">ยืนยันเริ่มงาน?</h2>
          <p className="text-zinc-400 mb-2">{record.work_order}</p>
          <p className="text-zinc-500 text-sm">{record.equipment_name}</p>
        </main>
        <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
          <div className="flex gap-3">
            <button onClick={() => setActiveModal(null)} className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]">
              ยกเลิก
            </button>
            <button onClick={handleStartJob} disabled={isSubmitting} className="flex-[2] h-14 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700">
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
              {isSubmitting ? 'กำลังบันทึก...' : 'เริ่มงานเลย'}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // Complete Job Form
  if (activeModal === 'complete') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModal(null)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <div>
              <p className="text-white font-bold">ปิดงาน (เสร็จสิ้น)</p>
              <p className="text-sm text-zinc-500">{record.work_order}</p>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle size={20} />
              <p className="font-semibold">กรอกข้อมูลสรุปการซ่อม</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              สาเหตุของปัญหา <span className="text-red-500">*</span>
            </label>
            <textarea
              value={completeForm.rootCause}
              onChange={(e) => setCompleteForm(prev => ({ ...prev, rootCause: e.target.value }))}
              placeholder="เช่น ลูกปืนหมดอายุ, สายพานหลวม..."
              className="w-full h-28 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500 resize-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              วิธีแก้ไข <span className="text-red-500">*</span>
            </label>
            <textarea
              value={completeForm.actionTaken}
              onChange={(e) => setCompleteForm(prev => ({ ...prev, actionTaken: e.target.value }))}
              placeholder="เช่น เปลี่ยนลูกปืนใหม่, ปรับความตึงสายพาน..."
              className="w-full h-28 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>
        </main>
        <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
          <div className="flex gap-3">
            <button onClick={() => setActiveModal(null)} className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]">
              ยกเลิก
            </button>
            <button onClick={handleCompleteJob} disabled={isSubmitting} className="flex-[2] h-14 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700">
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
              {isSubmitting ? 'กำลังบันทึก...' : 'ปิดงาน'}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // Hold Job Form
  if (activeModal === 'hold') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModal(null)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <p className="text-white font-bold">พักงานชั่วคราว</p>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20">
            <div className="flex items-center gap-2 text-orange-400">
              <Pause size={20} />
              <p className="font-semibold">ระบุเหตุผลที่ต้องพักงาน</p>
            </div>
          </div>

          <textarea
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="เช่น รออะไหล่, รอช่างผู้เชี่ยวชาญ..."
            className="w-full h-32 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 rounded-xl text-white focus:outline-none focus:border-orange-500 resize-none"
            autoFocus
          />
        </main>
        <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
          <div className="flex gap-3">
            <button onClick={() => setActiveModal(null)} className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]">
              ยกเลิก
            </button>
            <button onClick={handleHoldJob} disabled={isSubmitting} className="flex-[2] h-14 rounded-xl bg-orange-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700">
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Pause size={20} />}
              {isSubmitting ? 'กำลังบันทึก...' : 'พักงาน'}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // Cancel Job Form
  if (activeModal === 'cancel') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModal(null)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <p className="text-white font-bold">ยกเลิกงาน</p>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={20} />
              <p className="font-semibold">ระบุเหตุผลที่ต้องยกเลิก</p>
            </div>
          </div>

          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="เช่น เครื่องจักรถูกยกเลิกใช้งาน, แจ้งซ้ำ..."
            className="w-full h-32 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 rounded-xl text-white focus:outline-none focus:border-red-500 resize-none"
            autoFocus
          />
        </main>
        <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
          <div className="flex gap-3">
            <button onClick={() => setActiveModal(null)} className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]">
              ไม่ยกเลิก
            </button>
            <button onClick={handleCancelJob} disabled={isSubmitting} className="flex-[2] h-14 rounded-xl bg-red-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700">
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <XCircle size={20} />}
              {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันยกเลิก'}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // Resume Job Confirmation
  if (activeModal === 'resume') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveModal(null)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <p className="text-white font-bold">ทำงานต่อ</p>
          </div>
        </header>
        <main className="flex-1 p-6 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-sky-600 flex items-center justify-center mb-6">
            <Play size={40} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">กลับมาทำงานต่อ?</h2>
          <p className="text-zinc-400 mb-2">{record.work_order}</p>
          {record.on_hold_reason && (
            <p className="text-orange-400 text-sm bg-orange-500/10 px-4 py-2 rounded-xl mt-4">
              เหตุผลพัก: {record.on_hold_reason}
            </p>
          )}
        </main>
        <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
          <div className="flex gap-3">
            <button onClick={() => setActiveModal(null)} className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]">
              ยกเลิก
            </button>
            <button onClick={handleResumeJob} disabled={isSubmitting} className="flex-[2] h-14 rounded-xl bg-sky-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700">
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
              {isSubmitting ? 'กำลังบันทึก...' : 'ทำงานต่อ'}
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // Progress Update Modal (with integrated parts)
  if (activeModal === 'update') {
    return (
      <ProgressUpdateModal
        recordId={recordId}
        record={record}
        userId={userId}
        partsUsed={[]}
        onClose={() => setActiveModal(null)}
        onSuccess={() => {
          setActiveModal(null);
          fetchRecordDetail();
        }}
      />
    );
  }



  // ================== MAIN VIEW ==================
  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-black">

        {/* Header */}
        <header className="flex-none bg-zinc-950 border-b border-zinc-800/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
              <X size={20} className="text-zinc-400" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold truncate">{record.work_order}</p>
              <p className="text-sm text-zinc-500 truncate">{record.equipment_name}</p>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">

          {/* Status Card */}
          <div className="p-4">
            <div className={`p-5 rounded-2xl ${statusConfig.bg}/10 border-2 ${statusConfig.bg}/30 border-dashed`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl ${statusConfig.bg} flex items-center justify-center shadow-lg`}>
                  <StatusIcon size={28} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className={`text-2xl font-bold ${statusConfig.text}`}>{statusConfig.label}</p>
                  <p className="text-zinc-500 text-sm">{formatTime(record.created_at)}</p>
                </div>
              </div>
              {repairTime && (
                <div className="mt-4 pt-4 border-t border-zinc-800">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Clock size={16} />
                    <span className="text-sm">เวลาซ่อม:</span>
                    <span className="text-white font-bold">{repairTime}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Problem Description */}
          <div className="px-4 pb-4">
            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">ปัญหาที่พบ</p>
              <p className="text-white leading-relaxed">{record.description}</p>
              {record.notes && (
                <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-300">{record.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Repair Report (if completed) */}
          {record.status === 'completed' && (record.root_cause || record.action_taken) && (
            <div className="px-4 pb-4">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle size={18} className="text-emerald-500" />
                  <p className="font-bold text-emerald-400">ผลการซ่อม</p>
                </div>
                {record.root_cause && (
                  <div className="mb-3">
                    <p className="text-xs text-zinc-500 mb-1">สาเหตุ:</p>
                    <p className="text-white">{record.root_cause}</p>
                  </div>
                )}
                {record.action_taken && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">วิธีแก้ไข:</p>
                    <p className="text-white">{record.action_taken}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cancel/Hold Reason */}
          {(record.cancelled_reason || record.on_hold_reason) && (
            <div className="px-4 pb-4">
              <div className={`p-4 rounded-2xl border-2 ${record.cancelled_reason ? 'bg-red-500/10 border-red-500/30' : 'bg-orange-500/10 border-orange-500/30'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={18} className={record.cancelled_reason ? 'text-red-500' : 'text-orange-500'} />
                  <p className={`font-bold ${record.cancelled_reason ? 'text-red-400' : 'text-orange-400'}`}>
                    {record.cancelled_reason ? 'เหตุผลยกเลิก' : 'เหตุผลพักงาน'}
                  </p>
                </div>
                <p className="text-zinc-300">{record.cancelled_reason || record.on_hold_reason}</p>
              </div>
            </div>
          )}

          {/* Collapsible: Equipment */}
          <div className="px-4 pb-2">
            <button onClick={() => toggleSection('equipment')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 flex items-center justify-center">
                  <Package size={20} className="text-emerald-500" />
                </div>
                <div className="text-left">
                  <p className="text-white font-medium">รายละเอียดเครื่องจักร</p>
                  <p className="text-xs text-zinc-500">{record.equipment_code} • {record.location}</p>
                </div>
              </div>
              {expandedSections.equipment ? <ChevronUp size={20} className="text-zinc-500" /> : <ChevronDown size={20} className="text-zinc-500" />}
            </button>
            {expandedSections.equipment && (
              <div className="mt-2 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-3">
                <div className="flex justify-between"><span className="text-zinc-500">เครื่องจักร</span><span className="text-white font-medium">{record.equipment_name}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">รหัส</span><span className="text-emerald-400 font-mono">{record.equipment_code}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">สถานที่</span><span className="text-white">{record.location}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">ประเภทงาน</span><span className="text-white capitalize">{record.maintenance_type}</span></div>
              </div>
            )}
          </div>

          {/* Collapsible: Images */}
          {images.length > 0 && (
            <div className="px-4 pb-2">
              <button onClick={() => toggleSection('images')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-600/20 flex items-center justify-center">
                    <Camera size={20} className="text-sky-500" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium">รูปภาพ</p>
                    <p className="text-xs text-zinc-500">{images.length} รูป</p>
                  </div>
                </div>
                {expandedSections.images ? <ChevronUp size={20} className="text-zinc-500" /> : <ChevronDown size={20} className="text-zinc-500" />}
              </button>
              {expandedSections.images && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {images.map((img, idx) => (
                    <div key={idx} className="aspect-square rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-pointer active:scale-95" onClick={() => setPreviewImage(getImageUrl(img.image_url))}>
                      <img src={getImageUrl(img.image_url)} alt="" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Collapsible: History */}
          {timeline.length > 0 && (
            <div className="px-4 pb-4">
              <button onClick={() => toggleSection('history')} className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-700 flex items-center justify-center">
                    <History size={20} className="text-zinc-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium">ประวัติการทำงาน</p>
                    <p className="text-xs text-zinc-500">{timeline.length} รายการ</p>
                  </div>
                </div>
                {expandedSections.history ? <ChevronUp size={20} className="text-zinc-500" /> : <ChevronDown size={20} className="text-zinc-500" />}
              </button>
              {expandedSections.history && (
                <div className="mt-2 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
                  {timeline.map((item, index) => {
                    const statusInfo = getStatusConfig(item.status);
                    return (
                      <div key={index} className="flex gap-3">
                        <div className={`w-8 h-8 rounded-lg ${statusInfo.bg}/20 flex items-center justify-center shrink-0`}>
                          <statusInfo.icon size={14} className={statusInfo.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <p className="text-sm font-medium text-white">{statusInfo.label}</p>
                            <p className="text-xs text-zinc-600">{formatTime(item.created_at)}</p>
                          </div>
                          <p className="text-xs text-zinc-500">โดย {item.changed_by_name || 'System'}</p>
                          {item.notes && <p className="text-xs text-zinc-400 mt-1 italic">"{item.notes}"</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="h-48"></div>
        </main>

        {/* Footer - Direct Actions */}
        <footer className="fixed bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800/50 p-4 pb-8">

          {/* PENDING: Show Start button */}
          {record.status === 'pending' && (
            <div className="space-y-3">
              <button onClick={() => setActiveModal('start')} className="w-full h-16 rounded-2xl bg-emerald-600 text-white font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] shadow-lg">
                <Play size={24} />
                <span>เริ่มงานซ่อม</span>
              </button>
              <button onClick={() => setActiveModal('cancel')} className="w-full py-3 text-center text-zinc-500 text-sm active:text-zinc-300">
                ยกเลิกงาน
              </button>
            </div>
          )}

          {/* IN_PROGRESS: Show Complete + secondary buttons */}
          {record.status === 'in_progress' && (
            <div className="space-y-3">
              <button onClick={() => setActiveModal('complete')} className="w-full h-16 rounded-2xl bg-emerald-600 text-white font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] shadow-lg">
                <CheckCircle size={24} />
                <span>ปิดงาน (เสร็จสิ้น)</span>
              </button>
              <div className="flex gap-3">
                <button onClick={() => setActiveModal('update')} className="flex-1 h-12 rounded-xl bg-sky-600 text-white font-medium flex items-center justify-center gap-2 active:scale-[0.98]">
                  <TrendingUp size={18} />
                  <span>อัปเดต</span>
                </button>
              </div>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setActiveModal('hold')} className="text-zinc-500 text-sm active:text-zinc-300">พักงาน</button>
                <span className="text-zinc-700">•</span>
                <button onClick={() => setActiveModal('cancel')} className="text-zinc-500 text-sm active:text-zinc-300">ยกเลิก</button>
              </div>
            </div>
          )}

          {/* ON_HOLD: Show Resume button */}
          {record.status === 'on_hold' && (
            <div className="space-y-3">
              <button onClick={() => setActiveModal('resume')} className="w-full h-16 rounded-2xl bg-sky-600 text-white font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] shadow-lg">
                <Play size={24} />
                <span>ทำงานต่อ</span>
              </button>
              <button onClick={() => setActiveModal('cancel')} className="w-full py-3 text-center text-zinc-500 text-sm active:text-zinc-300">
                ยกเลิกงาน
              </button>
            </div>
          )}

          {/* COMPLETED/CANCELLED: Just close button */}
          {(record.status === 'completed' || record.status === 'cancelled') && (
            <button onClick={onClose} className="w-full h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold flex items-center justify-center gap-2 active:scale-[0.98]">
              <X size={20} />
              ปิด
            </button>
          )}
        </footer>
      </div>

      {/* Image Preview */}
      {previewImage && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <button className="absolute top-6 right-6 w-12 h-12 rounded-xl bg-zinc-800 text-white flex items-center justify-center" onClick={() => setPreviewImage(null)}>
            <X size={24} />
          </button>
          <img src={previewImage} alt="" className="max-w-full max-h-[85vh] object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}


    </>
  );
};

export default MaintenanceDetail;
