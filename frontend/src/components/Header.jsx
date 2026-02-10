import { useState } from 'react';
import {
  Shield,
  Wrench,
  LogOut,
  User,
  LayoutDashboard,
  Package,
  Gauge,
  Bell,
  ClipboardList,
  Building2,
  ChevronDown,
  BarChart3,
  Cog,
  FileText,
  ShoppingCart,
  Menu,
  X
} from 'lucide-react';
import Button from './ui/Button';
import Badge from './ui/Badge';
import NotificationBell from './NotificationBell';

const Header = ({ profile, onLogout, currentView, onViewChange }) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleMobileNav = (view) => {
    onViewChange(view);
    setIsSidebarOpen(false);
  };

  return (
    <>
      <header className="bg-gray-950 shadow-sm border-b border-gray-800 sticky top-0 z-40 backdrop-blur-md bg-gray-950/80">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              {/* Mobile Hamburger Button */}
              {profile && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <Menu className="w-6 h-6" />
                </button>
              )}

              <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-black shadow-lg shadow-green-500/20">
                <Wrench className="w-6 h-6" />
              </div>
              <div className="hidden xs:block">
                <h1 className="text-lg font-bold text-white leading-tight">Maintenance</h1>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold font-mono">SmartQuary EVR</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-6">
              {/* Desktop Navigation */}
              {profile && (
                <nav className="hidden md:flex items-center gap-1">
                  <Button
                    variant={currentView === 'maintenance' ? 'secondary' : 'ghost'}
                    onClick={() => onViewChange('maintenance')}
                    size="sm"
                    className={currentView === 'maintenance' ? 'bg-gray-800 text-green-400' : ''}
                  >
                    <Wrench className="w-4 h-4 mr-2" />
                    แจ้งซ่อม
                  </Button>
                  {['admin', 'moderator'].includes(profile.role) && (
                    <Button
                      variant={currentView === 'dashboard' ? 'secondary' : 'ghost'}
                      onClick={() => onViewChange('dashboard')}
                      size="sm"
                      className={currentView === 'dashboard' ? 'bg-gray-800 text-blue-400' : ''}
                    >
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Dashboard
                    </Button>
                  )}


                  {/* More Menu (Admin) */}
                  {['admin', 'moderator'].includes(profile.role) && (
                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        className={['equipment', 'checklists', 'users'].includes(currentView) ? 'bg-gray-800 text-amber-400' : ''}
                      >
                        <Cog className="w-4 h-4 mr-2" />
                        จัดการ
                        <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
                      </Button>

                      {showMoreMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                          <div className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-50 py-1">
                            <button
                              onClick={() => {
                                onViewChange('users');
                                setShowMoreMenu(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm flex items-center ${currentView === 'users' ? 'text-purple-400 bg-gray-800' : 'text-gray-300 hover:bg-gray-800'}`}
                            >
                              <User className="w-4 h-4 mr-2" />
                              จัดการผู้ใช้
                            </button>
                            <button
                              onClick={() => {
                                onViewChange('equipment');
                                setShowMoreMenu(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm flex items-center ${currentView === 'equipment' ? 'text-amber-400 bg-gray-800' : 'text-gray-300 hover:bg-gray-800'}`}
                            >
                              <Package className="w-4 h-4 mr-2" />
                              จัดการเครื่องจักร
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Notifications Bell */}
                  <NotificationBell profile={profile} onViewChange={onViewChange} />
                </nav>
              )}

              {profile && (
                <div className="flex items-center space-x-4">
                  {/* Mobile Notification Bell (Visible on mobile) */}
                  <div className="md:hidden">
                    <NotificationBell profile={profile} onViewChange={onViewChange} />
                  </div>

                  <div className="hidden md:flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-semibold text-white leading-none">{profile.displayName}</p>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        {['admin', 'moderator'].includes(profile.role) && (
                          <Badge variant="default" className="bg-purple-500/10 text-purple-400 border-purple-500/20 py-0 px-1.5 text-[10px]">
                            Admin
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="relative group">
                      <img
                        src={profile.pictureUrl}
                        alt={profile.displayName}
                        className="w-9 h-9 rounded-full border border-gray-700 ring-2 ring-transparent group-hover:ring-green-500/50 transition-all object-cover"
                        style={{ width: '36px', height: '36px', maxWidth: '36px', maxHeight: '36px' }}
                      />
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 border-2 border-gray-950 rounded-full"></div>
                    </div>
                  </div>

                  <div className="h-6 w-px bg-gray-800 hidden md:block"></div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onLogout}
                    className="hidden md:flex text-gray-400 hover:text-red-400 hover:bg-red-500/10 h-9 w-9"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Navigation Drawer */}
      {profile && (
        <div className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />

          {/* Sidebar */}
          <div className={`absolute top-0 left-0 w-3/4 max-w-xs h-full bg-gray-950 border-r border-gray-800 transform transition-transform duration-300 ease-out flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            {/* Sidebar Header */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-black">
                  <Wrench className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="font-bold text-white">Maintenance</h2>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">SmartQuary</p>
                </div>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-900"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Sidebar Links */}
            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-2">
              <button
                onClick={() => handleMobileNav('maintenance')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'maintenance' ? 'bg-green-500/10 text-green-400' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
              >
                <Wrench className="w-5 h-5" />
                <span className="font-medium">แจ้งซ่อม</span>
              </button>

              <button
                onClick={() => handleMobileNav('notifications')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'notifications' ? 'bg-purple-500/10 text-purple-400' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
              >
                <Bell className="w-5 h-5" />
                <span className="font-medium">การแจ้งเตือน</span>
              </button>

              {['admin', 'moderator'].includes(profile.role) && (
                <>
                  <div className="my-4 border-t border-gray-800/50 mx-4" />
                  <p className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Management</p>

                  <button
                    onClick={() => handleMobileNav('dashboard')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'dashboard' ? 'bg-blue-500/10 text-blue-400' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
                  >
                    <BarChart3 className="w-5 h-5" />
                    <span className="font-medium">Dashboard</span>
                  </button>

                  <button
                    onClick={() => handleMobileNav('equipment')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'equipment' ? 'bg-amber-500/10 text-amber-400' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
                  >
                    <Package className="w-5 h-5" />
                    <span className="font-medium">จัดการเครื่องจักร</span>
                  </button>

                  <button
                    onClick={() => handleMobileNav('users')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${currentView === 'users' ? 'bg-purple-500/10 text-purple-400' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}
                  >
                    <User className="w-5 h-5" />
                    <span className="font-medium">จัดการผู้ใช้</span>
                  </button>
                </>
              )}
            </div>

            {/* Sidebar Footer (User Profile) */}
            <div className="p-4 border-t border-gray-800 bg-gray-950/50">
              <div className="flex items-center gap-3 mb-4">
                <img
                  src={profile.pictureUrl}
                  alt={profile.displayName}
                  className="w-10 h-10 rounded-full bg-gray-800"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{profile.displayName}</p>
                  <p className="text-xs text-gray-500 capitalize">{profile.role}</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
              >
                <LogOut className="w-5 h-5" />
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
