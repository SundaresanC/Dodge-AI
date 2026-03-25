import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { Database, Lock, Loader2, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
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

const resetSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetFormValues = z.infer<typeof resetSchema>;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(data: ResetFormValues) {
    if (!token) return;
    setIsSubmitLoading(true);
    try {
      await fetchApi('/auth/reset-password', {
        method: 'POST',
        body: {
          token,
          newPassword: data.newPassword,
          confirmPassword: data.confirmPassword,
        },
      });
      setResetSuccess(true);
      toast.success('Password reset successfully!');
    } catch (error: any) {
      const msg = error?.data?.message || error?.message || 'Failed to reset password. The link may be expired or invalid.';
      toast.error(msg);
    } finally {
      setIsSubmitLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-2xl font-bold text-foreground">Invalid Reset Link</h1>
          <p className="text-muted-foreground text-sm">
            This password reset link is missing or malformed.
          </p>
          <Link
            to="/forgot-password"
            className="text-primary hover:text-primary/80 text-sm font-medium"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
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
            Set New Password
          </h1>
          <p className="text-muted-foreground text-center text-sm max-w-sm">
            Choose a strong password for your account.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

          {resetSuccess ? (
            <div className="flex flex-col items-center gap-4 relative py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-foreground">Password Reset!</h2>
                <p className="text-sm text-muted-foreground">
                  Your password has been updated. You can now sign in with your new password.
                </p>
              </div>
              <Button
                onClick={() => navigate('/login')}
                className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] mt-2"
              >
                Sign In
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 relative">
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground">New Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="••••••••"
                            className="pl-9 pr-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10"
                            autoFocus
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-2.5 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground">Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                          <Input
                            type={showConfirm ? 'text' : 'password'}
                            placeholder="••••••••"
                            className="pl-9 pr-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-2.5 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters with one uppercase letter and one number.
                </p>

                <Button
                  type="submit"
                  disabled={isSubmitLoading}
                  className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all mt-2"
                >
                  {isSubmitLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    'Reset Password'
                  )}
                </Button>
              </form>
            </Form>
          )}

          <div className="mt-8 text-center text-sm">
            <Link
              to="/login"
              className="flex items-center justify-center gap-1 text-primary hover:text-primary/80 font-medium transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Login
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
