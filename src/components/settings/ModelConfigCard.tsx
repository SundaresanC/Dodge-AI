import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Circle, Trash2, Edit2, ShieldCheck, ShieldX, Key, Loader2
} from 'lucide-react';
import {
  deleteAIModel, activateAIModel, verifyAIModel, type AIModelConfig
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const PROVIDER_LABELS: Record<string, string> = {
  GEMINI: 'Gemini',
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
};

const PROVIDER_COLORS: Record<string, string> = {
  GEMINI: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  OPENAI: 'text-green-400 bg-green-400/10 border-green-400/20',
  ANTHROPIC: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
};

const PURPOSE_LABELS: Record<string, string> = {
  NL_QUERY: 'Data Query',
  DEFAULT: 'Default',
};

interface ModelConfigCardProps {
  config: AIModelConfig;
  onEdit: (config: AIModelConfig) => void;
}

export function ModelConfigCard({ config, onEdit }: ModelConfigCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; error?: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteAIModel(config.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast({ title: 'Model configuration deleted' });
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateAIModel(config.id, config.purpose),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast({ title: `${config.displayName} set as active` });
    },
    onError: () => toast({ title: 'Activation failed', variant: 'destructive' }),
  });

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await verifyAIModel(config.id);
      setVerifyResult(res);
      if (res.valid) {
        toast({ title: 'API key is valid ✓' });
      } else {
        toast({ title: 'API key invalid', description: res.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Verification failed', variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative p-4 rounded-xl border transition-colors ${
        config.isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-card hover:border-border/80'
      }`}
    >
      {/* Active indicator */}
      {config.isActive && (
        <div className="absolute top-3 right-3">
          <CheckCircle2 className="h-4 w-4 text-primary" />
        </div>
      )}

      <div className="flex items-start gap-3 pr-6">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {/* Provider + Purpose badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${PROVIDER_COLORS[config.provider] ?? ''}`}>
              {PROVIDER_LABELS[config.provider] ?? config.provider}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground/70">
              {PURPOSE_LABELS[config.purpose] ?? config.purpose}
            </span>
          </div>

          {/* Display name + model id */}
          <div>
            <p className="text-sm font-medium text-foreground truncate">{config.displayName}</p>
            <p className="text-[11px] font-mono text-muted-foreground/70 truncate">{config.modelId}</p>
          </div>

          {/* Key status */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <Key className="h-3 w-3 text-muted-foreground/50" />
            {config.hasCustomKey ? (
              <span className="text-[10px] font-mono text-muted-foreground/70">
                Custom key: {config.keyPreview ?? '••••••••'}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-muted-foreground/50">Using system key</span>
            )}
            {verifyResult !== null && (
              verifyResult.valid
                ? <ShieldCheck className="h-3 w-3 text-green-400 ml-1" />
                : <ShieldX className="h-3 w-3 text-red-400 ml-1" />
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/50">
        {!config.isActive && (
          <button
            onClick={() => activateMutation.mutate()}
            disabled={activateMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
          >
            <Circle className="h-3 w-3" />
            Set Active
          </button>
        )}
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          Verify
        </button>
        <button
          onClick={() => onEdit(config)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Edit2 className="h-3 w-3" />
          Edit
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete "${config.displayName}"?`)) deleteMutation.mutate();
          }}
          disabled={deleteMutation.isPending}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-auto"
        >
          {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Delete
        </button>
      </div>
    </motion.div>
  );
}
