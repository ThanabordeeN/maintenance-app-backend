import { useState } from 'react';
import {
    X, ArrowLeft, TrendingUp, Camera, Check,
    Loader2, AlertCircle
} from 'lucide-react';
import { maintenanceAPI } from '../services/api';

const TABS = [
    { id: 'update', label: 'อัปเดต', icon: TrendingUp, color: 'sky' },
];

const ProgressUpdateModal = ({
    recordId,
    record,
    userId,
    onClose,
    onSuccess
}) => {
    const [activeTab, setActiveTab] = useState('update');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Update Tab State
    const [updateNotes, setUpdateNotes] = useState('');
    const [updateImages, setUpdateImages] = useState([]);
    const [updateImagePreviews, setUpdateImagePreviews] = useState([]);

    // Submit handlers
    const handleSubmitUpdate = async () => {
        if (submitting) return; // Prevent double submit
        if (!updateNotes.trim()) {
            setError('กรุณากรอกรายละเอียดความคืบหน้า');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('notes', updateNotes);
            formData.append('userId', userId);
            updateImages.forEach(img => formData.append('images', img));

            await maintenanceAPI.addProgressUpdate(recordId, formData);
            setSuccessMessage('บันทึกความคืบหน้าสำเร็จ');
            setTimeout(() => {
                onSuccess && onSuccess();
                onClose();
            }, 1000);
        } catch (err) {
            setError(err.message || 'เกิดข้อผิดพลาด');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = () => {
        handleSubmitUpdate();
    };

    const getSubmitButtonText = () => {
        if (submitting) return 'กำลังบันทึก...';
        return 'บันทึกอัปเดต';
    };

    const isSubmitDisabled = () => {
        if (submitting) return true;
        return !updateNotes.trim();
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
            {/* Header */}
            <header className="flex-none bg-zinc-950 border-b border-zinc-800/50">
                <div className="px-4 py-3 flex items-center gap-3">
                    <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 active:scale-95">
                        <ArrowLeft size={20} className="text-zinc-400" />
                    </button>
                    <div className="flex-1">
                        <p className="text-white font-bold">อัปเดตความคืบหน้า</p>
                        <p className="text-sm text-zinc-500">{record?.work_order}</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="px-4 pb-3 flex gap-2">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setError(''); }}
                                className={`flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition ${isActive
                                    ? `bg-${tab.color}-600 text-white`
                                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                                    }`}
                                style={isActive ? { backgroundColor: '#0284c7' } : {}}
                            >
                                <Icon size={16} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            {/* Success Message */}
            {successMessage && (
                <div className="bg-emerald-600/20 border-b border-emerald-500/30 p-4 flex items-center gap-3">
                    <Check className="text-emerald-400" size={24} />
                    <span className="text-emerald-300 font-medium">{successMessage}</span>
                </div>
            )}

            {/* Body */}
            <main className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* ===== UPDATE TAB ===== */}
                {activeTab === 'update' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">ความคืบหน้า</label>
                            <textarea
                                value={updateNotes}
                                onChange={(e) => setUpdateNotes(e.target.value)}
                                placeholder="เช่น กำลังรื้อสายพาน, พบลูกปืนแตก..."
                                className="w-full h-32 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 rounded-xl text-white focus:outline-none focus:border-sky-500 resize-none"
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-zinc-400 mb-2">แนบรูปภาพ (ไม่บังคับ)</label>
                            <div className="grid grid-cols-4 gap-2">
                                {updateImagePreviews.map((preview, index) => (
                                    <div key={index} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-800">
                                        <img src={preview} className="w-full h-full object-cover" alt="" />
                                        <button
                                            onClick={() => {
                                                setUpdateImages(prev => prev.filter((_, i) => i !== index));
                                                setUpdateImagePreviews(prev => prev.filter((_, i) => i !== index));
                                            }}
                                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 flex items-center justify-center"
                                        >
                                            <X size={14} className="text-white" />
                                        </button>
                                    </div>
                                ))}
                                {updateImages.length < 5 && (
                                    <label className="aspect-square rounded-xl border-2 border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer active:bg-zinc-800">
                                        <Camera size={24} className="text-zinc-500" />
                                        <span className="text-xs text-zinc-500 mt-1">เพิ่มรูป</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                const files = Array.from(e.target.files);
                                                const remaining = 5 - updateImages.length;
                                                files.slice(0, remaining).forEach(file => {
                                                    if (!file.type.startsWith('image/')) {
                                                        alert(`ไฟล์ ${file.name} ไม่ใช่รูปภาพ`);
                                                        return;
                                                    }
                                                    setUpdateImages(prev => [...prev, file]);
                                                    const reader = new FileReader();
                                                    reader.onloadend = () => setUpdateImagePreviews(prev => [...prev, reader.result]);
                                                    reader.readAsDataURL(file);
                                                });
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* Error */}
                {error && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3">
                        <AlertCircle className="text-red-400 shrink-0" size={20} />
                        <span className="text-red-300">{error}</span>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="flex-none bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold active:scale-[0.98]"
                    >
                        ยกเลิก
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitDisabled()}
                        className={`flex-[2] h-14 rounded-xl text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:bg-zinc-700 bg-sky-600`}
                    >
                        {submitting ? <Loader2 className="animate-spin" size={20} /> : null}
                        {getSubmitButtonText()}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default ProgressUpdateModal;
