import { LayoutDashboard, Database, Settings, LogOut, GitBranch, MessageSquare, Plus } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { fetchSessions } from '@/lib/graphApi';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';

const mainNav = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Graph Mapping', url: '/mapping', icon: GitBranch },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const collapsed = state === 'collapsed';
  const isOnMapping = location.pathname === '/mapping';

  const { data: sessionsData } = useQuery({
    queryKey: ['graph-chat-sessions'],
    queryFn: fetchSessions,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const recentSessions = (sessionsData?.sessions ?? []).slice(0, 5);

  const renderItems = (items: typeof mainNav) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild>
            <NavLink
              to={item.url}
              end={item.url === '/dashboard'}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeClassName="bg-sidebar-accent text-primary font-medium"
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="text-sm">{item.title}</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      <SidebarContent className="pt-6">
        <div
          onClick={() => navigate('/dashboard')}
          className={`px-4 mb-4 flex items-center gap-2 cursor-pointer ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Database className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-foreground tracking-tight">SAP O2C</span>
          )}
        </div>
        
        {!collapsed && user && (
          <div className="px-4 mb-8">
            <div className="bg-black/20 rounded-lg p-3 border border-white/5 flex flex-col items-start text-left overflow-hidden">
              <span className="text-sm font-medium text-foreground truncate w-full">{user.name}</span>
              <span className="text-xs text-muted-foreground truncate w-full">{user.email}</span>
            </div>
          </div>
        )}

        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 px-3 mb-1">Workspace</SidebarGroupLabel>}
          <SidebarGroupContent>
            {renderItems(mainNav)}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Recent Chats */}
        {!collapsed && recentSessions.length > 0 && (
          <SidebarGroup className="mt-2">
            <div className="flex items-center justify-between px-3 mb-1">
              <SidebarGroupLabel className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 p-0">
                Recent Chats
              </SidebarGroupLabel>
              <button
                onClick={() => {
                  if (!isOnMapping) navigate('/mapping');
                  window.dispatchEvent(new CustomEvent('sidebar-new-chat'));
                }}
                className="text-muted-foreground/60 hover:text-primary transition-colors"
                title="New Chat"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentSessions.map((s) => (
                  <SidebarMenuItem key={s.sessionId}>
                    <SidebarMenuButton asChild>
                      <button
                        onClick={() => {
                          if (!isOnMapping) navigate('/mapping');
                          window.dispatchEvent(
                            new CustomEvent('sidebar-switch-session', { detail: s.sessionId })
                          );
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full text-left"
                        title={s.firstQuery}
                      >
                        <MessageSquare className="h-[16px] w-[16px] shrink-0 text-muted-foreground/60" />
                        <span className="text-xs truncate">
                          {s.firstQuery?.slice(0, 32) || 'New conversation'}
                        </span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="pb-4">
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/settings"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-primary font-medium"
              >
                <Settings className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="text-sm">Settings</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <button 
                onClick={logout}
                className="flex items-center gap-3 px-3 py-2.5 w-full text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="text-sm">Log out</span>}
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
