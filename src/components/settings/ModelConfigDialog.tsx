import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import {
  createAIModel, updateAIModel, type AIModelConfig, type CreateModelConfigInput
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
  GEMINI: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  OPENAI: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  ANTHROPIC: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
};

const formSchema = z.object({
  provider: z.enum(['GEMINI', 'OPENAI', 'ANTHROPIC']),
  modelId: z.string().min(1, 'Required'),
  displayName: z.string().min(1, 'Required').max(60),
  purpose: z.enum(['NL_QUERY', 'DEFAULT']),
  isActive: z.boolean(),
  apiKey: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ModelConfigDialogProps {
  open: boolean;
  onClose: () => void;
  editing?: AIModelConfig | null;
}

export function ModelConfigDialog({ open, onClose, editing }: ModelConfigDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customModelId, setCustomModelId] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: 'GEMINI',
      modelId: PROVIDER_MODELS.GEMINI[0].id,
      displayName: '',
      purpose: 'NL_QUERY',
      isActive: false,
      apiKey: '',
    },
  });

  const selectedProvider = watch('provider');
  const selectedModelId = watch('modelId');
  const modelOptions = PROVIDER_MODELS[selectedProvider] ?? [];

  // Reset form when editing changes
  useEffect(() => {
    if (editing) {
      const knownIds = (PROVIDER_MODELS[editing.provider] ?? []).map((m) => m.id);
      const isKnown = knownIds.includes(editing.modelId);
      setCustomModelId(isKnown ? '' : editing.modelId);
      reset({
        provider: editing.provider,
        modelId: isKnown ? editing.modelId : '__custom',
        displayName: editing.displayName,
        purpose: editing.purpose,
        isActive: editing.isActive,
        apiKey: '',
      });
    } else {
      setCustomModelId('');
      reset({
        provider: 'GEMINI',
        modelId: PROVIDER_MODELS.GEMINI[0].id,
        displayName: '',
        purpose: 'NL_QUERY',
        isActive: false,
        apiKey: '',
      });
    }
  }, [editing, reset]);

  // Auto-update modelId when provider changes
  const handleProviderChange = (provider: 'GEMINI' | 'OPENAI' | 'ANTHROPIC') => {
    setValue('provider', provider);
    setValue('modelId', PROVIDER_MODELS[provider]?.[0]?.id ?? '');
    setCustomModelId('');
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateModelConfigInput) => createAIModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast({ title: 'Model configuration saved' });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? 'Save failed';
      toast({ title: 'Failed to save', description: msg, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { modelId: string; displayName: string; apiKey?: string | null }) =>
      updateAIModel(editing!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-models'] });
      toast({ title: 'Model configuration updated' });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? 'Update failed';
      toast({ title: 'Failed to update', description: msg, variant: 'destructive' });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const resolveModelId = (formModelId: string): string | null => {
    if (formModelId === '__custom') {
      const trimmed = customModelId.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return formModelId;
  };

  const onSubmit = (values: FormValues) => {
    const resolvedModelId = resolveModelId(values.modelId);
    if (!resolvedModelId) {
      toast({ title: 'Custom model ID is required', variant: 'destructive' });
      return;
    }
    if (editing) {
      updateMutation.mutate({
        modelId: resolvedModelId,
        displayName: values.displayName,
        apiKey: values.apiKey || undefined,
      });
    } else {
      createMutation.mutate({
        provider: values.provider,
        modelId: resolvedModelId,
        displayName: values.displayName,
        purpose: values.purpose,
        isActive: values.isActive,
        apiKey: values.apiKey || undefined,
      });
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">
              {editing ? 'Edit Model Configuration' : 'Add AI Model'}
            </h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="p-5 flex flex-col gap-4">
            {/* Provider (only for create) */}
            {!editing && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono text-muted-foreground">Provider</label>
                <div className="flex gap-2">
                  {(['GEMINI', 'OPENAI', 'ANTHROPIC'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleProviderChange(p)}
                      className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-colors ${
                        selectedProvider === p
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-border/80'
                      }`}
                    >
                      {p === 'GEMINI' ? 'Gemini' : p === 'OPENAI' ? 'OpenAI' : 'Anthropic'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Model ID */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-muted-foreground">Model</label>
              <select
                {...register('modelId')}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                <option value="__custom">Custom model ID…</option>
              </select>
              {selectedModelId === '__custom' && (
                <input
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="Enter exact model ID, e.g. gemini-2.5-pro-preview"
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                  autoFocus
                />
              )}
              {errors.modelId && (
                <p className="text-[11px] text-destructive font-mono">{errors.modelId.message}</p>
              )}
            </div>

            {/* Display Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-muted-foreground">Display Name</label>
              <input
                {...register('displayName')}
                placeholder="e.g. My Gemini Flash"
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
              {errors.displayName && (
                <p className="text-[11px] text-destructive font-mono">{errors.displayName.message}</p>
              )}
            </div>

            {/* Purpose (only for create) */}
            {!editing && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono text-muted-foreground">Purpose</label>
                <select
                  {...register('purpose')}
                  className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
                >
                  <option value="NL_QUERY">Data Query (Natural Language → SQL)</option>
                  <option value="DEFAULT">Default (any purpose)</option>
                </select>
              </div>
            )}

            {/* API Key */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-muted-foreground">
                API Key {editing ? '(leave blank to keep current)' : '(optional — uses system key if blank)'}
              </label>
              <input
                {...register('apiKey')}
                type="password"
                placeholder={editing && 'hasCustomKey' in (editing ?? {}) && (editing as AIModelConfig).hasCustomKey ? '••••••••' : 'sk-…'}
                autoComplete="new-password"
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
              <p className="text-[10px] text-muted-foreground/60 font-mono">
                Stored encrypted with AES-256-GCM
              </p>
            </div>

            {/* Active toggle (only for create) */}
            {!editing && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register('isActive')} className="accent-primary" />
                <span className="text-xs font-mono text-muted-foreground">Set as active model for this purpose</span>
              </label>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-xs font-mono border border-border text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 py-2 rounded-lg text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                {editing ? 'Update' : 'Add Model'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
