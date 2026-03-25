import { motion } from 'framer-motion';
import { AppLayout } from '@/components/layout/AppLayout';
import { GitBranch, Settings, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function Index() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <AppLayout>
      <div className="p-6 lg:p-10 max-w-4xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-3xl font-semibold text-foreground">
            {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{dateStr}</p>
        </motion.div>

        {/* Action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            onClick={() => navigate('/mapping')}
            className="group text-left rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-card/80 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <GitBranch className="h-4 w-4 text-primary" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="font-medium text-foreground">Graph Mapping</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Visually explore the Order-to-Cash flow. Ask FlowMind AI to trace documents, find gaps, and analyse patterns.
            </p>
          </motion.button>

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            onClick={() => navigate('/settings')}
            className="group text-left rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-card/80 transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Settings className="h-4 w-4 text-primary" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <h3 className="font-medium text-foreground">AI Model Settings</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Configure AI providers (Gemini, OpenAI, Anthropic) and manage API keys for NL queries.
            </p>
          </motion.button>
        </div>

        {/* Dataset overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-6 rounded-xl border border-border bg-card p-5"
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-4">SAP O2C Dataset</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              'Sales Orders', 'Billing Documents', 'Deliveries',
              'Business Partners', 'Products', 'Payments',
              'Journal Entries', 'Plants & Locations',
            ].map((entity) => (
              <div key={entity} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                {entity}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </AppLayout>
  );
}
