import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModelConfigCard } from '@/components/settings/ModelConfigCard';
import { ModelConfigDialog } from '@/components/settings/ModelConfigDialog';
import { getAIModels, type AIModelConfig } from '@/lib/api';
import { Plus, Settings as SettingsIcon, CheckCircle2, XCircle, Lock } from 'lucide-react';

const PROVIDER_DISPLAY: Record<string, string> = {
  GEMINI: 'Gemini',
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
};

export default function Settings() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AIModelConfig | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: getAIModels,
  });

  const configs = data?.configs ?? [];
  const systemKeys = data?.systemKeys ?? { GEMINI: false, OPENAI: false, ANTHROPIC: false };
  const encryptionEnabled = data?.encryptionEnabled ?? false;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (config: AIModelConfig) => {
    setEditing(config);
    setDialogOpen(true);
  };

  return (
    <AppLayout>
      <div className="p-6 lg:p-10 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-9 w-9 rounded-xl bg-muted/50 flex items-center justify-center">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Settings</h1>
            <p className="text-xs text-muted-foreground font-mono">Manage AI models and configuration</p>
          </div>
        </div>

        {/* System Keys Status */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground/70">System API Keys</h2>
            {encryptionEnabled
              ? <span className="flex items-center gap-1 text-[10px] font-mono text-green-400"><Lock className="h-3 w-3" />Encryption enabled</span>
              : <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400"><Lock className="h-3 w-3" />Encryption key not set</span>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(Object.entries(systemKeys) as [string, boolean][]).map(([provider, available]) => (
              <div
                key={provider}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm ${
                  available
                    ? 'border-green-400/20 bg-green-400/5'
                    : 'border-border bg-muted/20'
                }`}
              >
                {available
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                <span className={`text-xs font-mono ${available ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {PROVIDER_DISPLAY[provider]}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] font-mono text-muted-foreground/50">
            Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in your server .env file
          </p>
        </section>

        {/* AI Model Configurations */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground/70">AI Model Configurations</h2>
              <p className="text-[11px] text-muted-foreground/50 font-mono mt-0.5">
                Per-user model overrides with encrypted API key storage
              </p>
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Model
            </button>
          </div>

          {isLoading && (
            <div className="grid gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 rounded-xl bg-muted/30 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && configs.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed border-border"
            >
              <SettingsIcon className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/70">No model configurations yet</p>
              <p className="text-xs font-mono text-muted-foreground/50 text-center max-w-xs">
                Add a custom model to override the system default, or to use your own API keys
              </p>
              <button
                onClick={openCreate}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono border border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
              >
                <Plus className="h-3 w-3" /> Add your first model
              </button>
            </motion.div>
          )}

          <div className="grid gap-3">
            <AnimatePresence initial={false}>
              {configs.map((config) => (
                <ModelConfigCard key={config.id} config={config} onEdit={openEdit} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      </div>

      <ModelConfigDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        editing={editing}
      />
    </AppLayout>
  );
}
