import * as React from 'react';
import { Settings, Moon } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { DialogTrigger } from '@/components/ui/dialog';
import { useTheme } from '@/components/providers/theme-provider';
import { SettingsDialog } from '@/components/settings/settings-dialog';

export function NavSecondary() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeToggle = (checked: boolean) => {
    setTheme(checked ? 'dark' : 'light');
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Theme Toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="sm">
              <div>
                <Moon />
                <span>Dark Mode</span>
                {mounted && (
                  <Switch
                    checked={resolvedTheme === 'dark'}
                    onCheckedChange={handleThemeToggle}
                    className="ml-auto"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Settings */}
          <SidebarMenuItem>
            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <SidebarMenuButton size="sm">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </DialogTrigger>
            </SettingsDialog>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
