import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { Database, Mail, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { fetchApi } from '@/lib/api';

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const form = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: ForgotFormValues) {
    setIsSubmitLoading(true);
    try {
      await fetchApi('/auth/forgot-password', {
        method: 'POST',
        body: { email: data.email },
      });
      setEmailSent(true);
      toast.success('Reset link sent! Check your email.');
    } catch {
      // Show success even on error to prevent email enumeration
      setEmailSent(true);
    } finally {
      setIsSubmitLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background ambient-glow relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-md p-8 relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(234,179,8,0.2)]">
            <Database className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
            Reset Password
          </h1>
          <p className="text-muted-foreground text-center text-sm max-w-sm">
            Enter your email and we'll send you a link to reset your password.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

          {emailSent ? (
            <div className="flex flex-col items-center gap-4 relative py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-foreground">Check Your Email</h2>
                <p className="text-sm text-muted-foreground">
                  Password reset link has been sent to your email.
                </p>
              </div>
              <Link
                to="/login"
                className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors mt-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </Link>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 relative">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground">Email Address</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                          <Input
                            placeholder="name@example.com"
                            className="pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10"
                            autoFocus
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isSubmitLoading}
                  className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all mt-2"
                >
                  {isSubmitLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>

                <div className="mt-3 text-center text-sm">
                  <Link
                    to="/login"
                    className="flex items-center justify-center gap-1 text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Login
                  </Link>
                </div>
              </form>
            </Form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
