import { Button } from '@/components/ui/button';
import { FileText, MessageSquare } from 'lucide-react';

type MobileToggleProps = {
  mobileView: 'pdf' | 'chat';
  onViewChange: (view: 'pdf' | 'chat') => void;
};

export function MobileToggle({ mobileView, onViewChange }: MobileToggleProps) {
  return (
    <div className="flex w-full justify-center gap-2 p-4 pt-0">
      <Button
        variant={mobileView === 'pdf' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onViewChange('pdf')}
        className="flex items-center gap-2"
        type="button"
      >
        <FileText className="h-4 w-4" />
        PDF
      </Button>
      <Button
        variant={mobileView === 'chat' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onViewChange('chat')}
        className="flex items-center gap-2"
        type="button"
      >
        <MessageSquare className="h-4 w-4" />
        Chat
      </Button>
    </div>
  );
}
