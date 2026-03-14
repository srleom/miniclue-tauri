import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center gap-7 text-center">
      {/* Logo + wordmark */}
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.svg" alt="MiniClue" className="h-15 dark:invert" />
        <span className="border-border mt-3 inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium tracking-tight uppercase">
          Read and chat with any document, privately
        </span>
      </div>

      {/* App screenshot */}
      <div className="w-full overflow-hidden rounded-xl border shadow-lg">
        <img
          src="/images/welcome.png"
          alt="MiniClue in action"
          className="w-full"
          draggable={false}
        />
      </div>

      <Button size="lg" className="w-full" onClick={onNext}>
        Get Started
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
