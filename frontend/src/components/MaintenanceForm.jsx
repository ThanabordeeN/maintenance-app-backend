import { useState, useEffect, useRef } from 'react';
import { Camera, CheckCircle2, X, Wrench, Factory, Zap, FileText, Plus, AlertCircle, AlertTriangle, Settings, Volume2, Gauge, Droplets, ClipboardCheck, HelpCircle, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import { equipmentAPI, maintenanceAPI } from '../services/api';

const MaintenanceForm = ({ userId, onSuccess, onCancel }) => {
  const [equipment, setEquipment] = useState([]);
  const [formData, setFormData] = useState({
    equipmentId: '',
    maintenanceType: '',
    status: 'pending',
    priority: 'medium',
    title: '',
    description: '',
    notes: '',
    scheduledDate: '',
    setEquipmentInactive: false
  });
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const fileInputRef = useRef(null);

  const issueTypes = [
    { id: 'belt', label: 'สายพานขาด/หลวม', icon: Settings, color: 'orange', desc: 'สายพานเครื่องขาด หรือหลวม' },
    { id: 'bearing', label: 'Bearing ผิดปกติ', icon: Gauge, color: 'red', desc: 'Bearing มีเสียงดัง หรือร้อนผิดปกติ' },
    { id: 'motor', label: 'มอเตอร์มีปัญหา', icon: Zap, color: 'yellow', desc: 'มอเตอร์ทำงานผิดปกติ หรือไม่ทำงาน' },
    { id: 'noise', label: 'เสียงดังผิดปกติ', icon: Volume2, color: 'purple', desc: 'เครื่องจักรมีเสียงผิดปกติ' },
    { id: 'vibration', label: 'สั่นผิดปกติ', icon: AlertTriangle, color: 'pink', desc: 'เครื่องสั่นผิดปกติ' },
    { id: 'oil', label: 'น้ำมันรั่ว/ต้องเติม', icon: Droplets, color: 'blue', desc: 'น้ำมันรั่ว หรือต้องเติม' },
    { id: 'routine', label: 'ตรวจสอบตามรอบ', icon: ClipboardCheck, color: 'green', desc: 'การตรวจสอบตามกำหนด PM' },
    { id: 'other', label: 'อื่นๆ', icon: HelpCircle, color: 'gray', desc: 'ปัญหาอื่นๆ ที่ไม่ระบุข้างต้น' }
  ];

  const priorities = [
    { id: 'low', label: 'ต่ำ', desc: 'ไม่เร่งด่วน', color: 'green', icon: '🟢' },
    { id: 'medium', label: 'ปกติ', desc: 'ทำตามลำดับ', color: 'yellow', icon: '🟡' },
    { id: 'high', label: 'ด่วน', desc: 'ต้องทำเร็ว', color: 'orange', icon: '🟠' },
    { id: 'critical', label: 'วิกฤต', desc: 'หยุดสายการผลิต', color: 'red', icon: '🔴' }
  ];

  const getColorClasses = (color, isSelected) => {
    const colors = {
      orange: isSelected ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'border-zinc-700 hover:border-orange-500/50',
      red: isSelected ? 'bg-red-500/20 border-red-500 text-red-400' : 'border-zinc-700 hover:border-red-500/50',
      yellow: isSelected ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'border-zinc-700 hover:border-amber-500/50',
      purple: isSelected ? 'bg-violet-500/20 border-violet-500 text-violet-400' : 'border-zinc-700 hover:border-violet-500/50',
      pink: isSelected ? 'bg-pink-500/20 border-pink-500 text-pink-400' : 'border-zinc-700 hover:border-pink-500/50',
      blue: isSelected ? 'bg-sky-500/20 border-sky-500 text-sky-400' : 'border-zinc-700 hover:border-sky-500/50',
      green: isSelected ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'border-zinc-700 hover:border-emerald-500/50',
      gray: isSelected ? 'bg-zinc-500/20 border-zinc-500 text-zinc-400' : 'border-zinc-700 hover:border-zinc-500/50',
    };
    return colors[color] || colors.gray;
  };

  useEffect(() => {
    fetchEquipment();
  }, []);

  const fetchEquipment = async () => {
    try {
      const data = await equipmentAPI.getAll();
      setEquipment(data.equipment || []);
    } catch (error) {
      console.error('Error fetching equipment:', error);
    }
  };

  const handleSelectIssue = (issue) => {
    setFormData(prev => ({
      ...prev,
      maintenanceType: issue.id,
      title: issue.label,
      description: issue.desc
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.equipmentId || !formData.maintenanceType) {
      alert('กรุณาเลือกเครื่องจักรและประเภทปัญหา');
      return;
    }

    setLoading(true);
    try {
      const formDataToSend = new FormData();
      formDataToSend.append('equipmentId', formData.equipmentId);
      formDataToSend.append('userId', userId);
      formDataToSend.append('maintenanceType', formData.maintenanceType);
      formDataToSend.append('priority', formData.priority);
      formDataToSend.append('status', formData.status);
      formDataToSend.append('title', formData.title);
      formDataToSend.append('description', formData.description);
      formDataToSend.append('setEquipmentInactive', formData.setEquipmentInactive);
      if (formData.notes) formDataToSend.append('notes', formData.notes);

      if (selectedImages.length > 0) {
        selectedImages.forEach(image => {
          formDataToSend.append('images', image);
        });
      }

      await maintenanceAPI.create(formDataToSend);

      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        if (onSuccess) onSuccess();
      }, 1500);

    } catch (error) {
      console.error('Error creating maintenance record:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const remainingSlots = 5 - selectedImages.length;
      const filesToAdd = files.slice(0, remainingSlots);

      if (files.length > remainingSlots) {
        alert('อัปโหลดรูปภาพได้สูงสุด 5 รูป');
      }

      filesToAdd.forEach(file => {
        if (file.size > 10 * 1024 * 1024) {
          alert(`ไฟล์ ${file.name} มีขนาดเกิน 10MB`);
          return;
        }
        if (!file.type.startsWith('image/')) {
          alert(`ไฟล์ ${file.name} ไม่ใช่ไฟล์รูปภาพที่รองรับ`);
          return;
        }

        setSelectedImages(prev => [...prev, file]);
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreviews(prev => [...prev, reader.result]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleRemoveImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const selectedEquipment = equipment.find(e => e.id == formData.equipmentId);
  const selectedIssue = issueTypes.find(i => i.id === formData.maintenanceType);

  return (
    <div className="fixed inset-0 z-[100] bg-black animate-in fade-in duration-200 flex flex-col h-[100dvh]">
      {/* Success Toast */}
      {showSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-full duration-300">
          <CheckCircle2 size={24} />
          <div>
            <p className="font-bold">บันทึกสำเร็จ!</p>
            <p className="text-sm opacity-90">ระบบได้บันทึกข้อมูลเรียบร้อยแล้ว</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex-none bg-zinc-950 border-b border-zinc-800/50">
        <div className="flex items-center h-16 px-4">
          <button
            onClick={currentStep > 1 ? () => setCurrentStep(currentStep - 1) : onCancel}
            className="w-12 h-12 flex items-center justify-center rounded-xl bg-zinc-900 hover:bg-zinc-800 active:scale-95 transition-all"
          >
            {currentStep > 1 ? <ArrowLeft size={24} className="text-zinc-400" /> : <X size={24} className="text-zinc-400" />}
          </button>
          <div className="flex-1 ml-4">
            <h1 className="text-lg font-semibold text-white">แจ้งซ่อมบำรุง</h1>
            <p className="text-sm text-zinc-500">ขั้นตอน {currentStep} จาก 3</p>
          </div>
        </div>

        {/* Step Progress Bar */}
        <div className="px-4 pb-4">
          <div className="flex gap-2">
            {[1, 2, 3].map(step => (
              <div key={step} className={`flex-1 h-1.5 rounded-full transition-colors ${currentStep >= step ? 'bg-emerald-500' : 'bg-zinc-800'
                }`} />
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-32">
        <div className="p-4">

          {/* Step 1: เลือกเครื่องจักร */}
          {currentStep === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-zinc-900 rounded-2xl border border-zinc-800 mb-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg">
                  <Factory size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">เลือกเครื่องจักร</h3>
                  <p className="text-sm text-zinc-500">เลือกเครื่องที่ต้องการแจ้งซ่อม</p>
                </div>
              </div>

              {equipment.length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                  <Factory size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">ไม่พบเครื่องจักร</p>
                  <p className="text-sm">กรุณาเพิ่มเครื่องจักรในระบบก่อน</p>
                </div>
              ) : (
                equipment.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, equipmentId: item.id }));
                      setCurrentStep(2);
                    }}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all active:scale-[0.98] ${formData.equipmentId == item.id
                      ? 'bg-emerald-500/10 border-emerald-500'
                      : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                      }`}
                  >
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${formData.equipmentId == item.id ? 'bg-emerald-600' : 'bg-zinc-800'
                      }`}>
                      <Factory size={28} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className={`font-semibold text-lg truncate ${formData.equipmentId == item.id ? 'text-emerald-400' : 'text-white'}`}>
                        {item.equipment_name}
                      </p>
                      <p className="text-sm text-zinc-500 truncate">{item.equipment_code} • {item.location || 'ไม่ระบุตำแหน่ง'}</p>
                    </div>
                    <ChevronRight size={24} className="text-zinc-600 shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {/* Step 2: เลือกประเภทปัญหา */}
          {currentStep === 2 && (
            <div className="space-y-4">
              {/* Selected Equipment Badge */}
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center">
                  <Factory size={24} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-emerald-400 font-medium">เครื่องจักรที่เลือก</p>
                  <p className="text-white font-semibold truncate">{selectedEquipment?.equipment_name}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-zinc-900 rounded-2xl border border-zinc-800">
                <div className="w-12 h-12 rounded-xl bg-sky-600 flex items-center justify-center shadow-lg">
                  <AlertTriangle size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">เลือกประเภทปัญหา</h3>
                  <p className="text-sm text-zinc-500">ระบุอาการหรือปัญหาที่พบ</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {issueTypes.map((issue) => {
                  const Icon = issue.icon;
                  const isSelected = formData.maintenanceType === issue.id;
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => {
                        handleSelectIssue(issue);
                        setCurrentStep(3);
                      }}
                      className={`p-4 rounded-2xl border-2 transition-all text-left flex flex-col gap-2 active:scale-[0.98] ${getColorClasses(issue.color, isSelected)
                        } bg-zinc-900`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isSelected ? 'bg-current/20' : 'bg-zinc-800'
                        }`}>
                        <Icon size={24} className={isSelected ? '' : 'text-zinc-400'} />
                      </div>
                      <div>
                        <p className={`font-semibold ${isSelected ? '' : 'text-white'}`}>{issue.label}</p>
                        <p className="text-xs text-zinc-500 line-clamp-2">{issue.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 3: รายละเอียดและยืนยัน */}
          {currentStep === 3 && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Summary Badges */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                  <p className="text-xs text-emerald-400 font-medium">เครื่องจักร</p>
                  <p className="text-white font-semibold text-sm truncate">{selectedEquipment?.equipment_name}</p>
                </div>
                <div className={`border rounded-xl p-3 ${getColorClasses(selectedIssue?.color, true)}`}>
                  <p className="text-xs font-medium opacity-70">ประเภทปัญหา</p>
                  <p className="font-semibold text-sm truncate">{selectedIssue?.label}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-zinc-900 rounded-2xl border border-zinc-800">
                <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg">
                  <FileText size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">รายละเอียดเพิ่มเติม</h3>
                  <p className="text-sm text-zinc-500">กรอกข้อมูลและแนบรูปภาพ</p>
                </div>
              </div>

              {/* Priority Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-300">
                  ระดับความเร่งด่วน <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {priorities.map((p) => {
                    const isSelected = formData.priority === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, priority: p.id })}
                        className={`h-16 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 active:scale-95 ${getColorClasses(p.color, isSelected)
                          } bg-zinc-900`}
                      >
                        <span className="text-xl">{p.icon}</span>
                        <span className={`text-xs font-semibold ${isSelected ? '' : 'text-white'}`}>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment Downtime Toggle */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-300">สถานะเครื่องจักร</label>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, setEquipmentInactive: !formData.setEquipmentInactive })}
                  className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between active:scale-[0.98] ${formData.setEquipmentInactive
                    ? 'bg-red-500/10 border-red-500/50'
                    : 'bg-zinc-900 border-zinc-800'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${formData.setEquipmentInactive ? 'bg-red-500/20' : 'bg-zinc-800'
                      }`}>
                      <Factory className={`w-6 h-6 ${formData.setEquipmentInactive ? 'text-red-400' : 'text-zinc-500'}`} />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-white">{formData.setEquipmentInactive ? '🔴 หยุดเครื่องจักร' : '🟢 เครื่องยังทำงานอยู่'}</p>
                      <p className="text-xs text-zinc-500">
                        {formData.setEquipmentInactive
                          ? 'เครื่องจะถูกตั้งเป็น Inactive'
                          : 'เครื่องยังใช้งานได้ปกติ'
                        }
                      </p>
                    </div>
                  </div>
                  <div className={`w-14 h-8 rounded-full transition-all flex items-center ${formData.setEquipmentInactive ? 'bg-red-500' : 'bg-zinc-700'
                    }`}>
                    <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-all ${formData.setEquipmentInactive ? 'ml-7' : 'ml-1'
                      }`} />
                  </div>
                </button>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-300">รายละเอียดเพิ่มเติม</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full h-24 px-4 py-3 bg-zinc-900 border-2 border-zinc-800 text-white rounded-xl text-base resize-none focus:outline-none focus:border-sky-500"
                  placeholder="อธิบายอาการหรือรายละเอียดเพิ่มเติม..."
                />
              </div>

              {/* Photo Upload */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-400">แนบรูปภาพ (ถ้ามี)</label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />

                <div className="grid grid-cols-4 gap-2">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
                      <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(index)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 flex items-center justify-center"
                      >
                        <X size={14} className="text-white" />
                      </button>
                    </div>
                  ))}

                  {selectedImages.length < 5 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-900/50 flex flex-col items-center justify-center cursor-pointer hover:border-zinc-600 active:scale-95 transition-all"
                    >
                      <Plus size={24} className="text-zinc-500" />
                      <span className="text-xs text-zinc-500 mt-1">เพิ่ม</span>
                    </button>
                  )}
                </div>
              </div>
            </form>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800/50 p-4 pb-8">
        {currentStep === 3 ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="flex-1 h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <ArrowLeft size={20} />
              ย้อนกลับ
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-[2] h-14 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg disabled:bg-zinc-700 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} />
                  ส่งใบแจ้งซ่อม
                </>
              )}
            </button>
          </div>
        ) : (
          <button
            onClick={onCancel}
            className="w-full h-14 rounded-xl bg-zinc-800 text-zinc-300 font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <X size={20} />
            ยกเลิก
          </button>
        )}
      </footer>
    </div>
  );
};

export default MaintenanceForm;
