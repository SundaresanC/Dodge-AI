import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { Database, Mail, Lock, User, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function Signup() {
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  });

  async function onSubmit(data: SignupFormValues) {
    setIsSubmitLoading(true);
    try {
      await signup(data);
      toast.success('Account created successfully!');
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      toast.error(error.error || 'Failed to create account. Please try again.');
    } finally {
      setIsSubmitLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background ambient-glow relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 -translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[100px] translate-y-1/2 translate-x-1/2 pointer-events-none" />

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
            Create an account
          </h1>
          <p className="text-muted-foreground text-center text-sm max-w-sm">
            Create an account to start querying your SAP O2C data.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 relative">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <Input
                      placeholder="Alex Chen"
                      className={`pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10 ${errors.name ? 'border-destructive/50 focus-visible:ring-destructive' : ''}`}
                      {...field}
                    />
                  )}
                />
              </div>
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                <Controller
                  name="email"
                  control={control}
                  render={({ field }) => (
                    <Input
                      placeholder="name@example.com"
                      className={`pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10 ${errors.email ? 'border-destructive/50 focus-visible:ring-destructive' : ''}`}
                      {...field}
                    />
                  )}
                />
              </div>
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                <Controller
                  name="password"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className={`pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10 ${errors.password ? 'border-destructive/50 focus-visible:ring-destructive' : ''}`}
                      {...field}
                    />
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-2.5 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              disabled={isSubmitLoading}
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all group mt-2"
            >
              {isSubmitLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <>
                  Create Account
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm">
            <span className="text-muted-foreground">Already have an account? </span>
            <Link
              to="/login"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
