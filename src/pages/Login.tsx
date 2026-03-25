import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { Database, Mail, Lock, Loader2, ArrowRight, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
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

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/dashboard';

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsSubmitLoading(true);
    try {
      await login(data);
      toast.success('Welcome back!');
      navigate(from, { replace: true });
    } catch (error: any) {
      toast.error(error.error || 'Failed to sign in. Please check your credentials.');
    } finally {
      setIsSubmitLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background ambient-glow relative overflow-hidden">
      {/* Back to Home */}
      <Link
        to="/"
        className="absolute top-6 left-6 z-20 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>

      {/* Decorative background elements */}
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
            Welcome back
          </h1>
          <p className="text-muted-foreground text-center text-sm max-w-sm">
            Sign in to explore your SAP Order-to-Cash data.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 relative">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground">Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                        <Input
                          placeholder="name@example.com"
                          className="pl-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-muted-foreground">Password</FormLabel>
                      <Link
                        to="/forgot-password"
                        className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="pl-9 pr-9 bg-black/20 border-white/10 focus-visible:ring-primary/50 transition-all h-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute right-3 top-2.5 text-muted-foreground/50 hover:text-muted-foreground//80 transition-colors"
                          tabIndex={-1}
                        >
                          {
                            showPassword
                              ? <EyeOff className="h-4 w-4" />
                              : <Eye className="h-4 w-4" />
                          }
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isSubmitLoading}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all group mt-2"
              >
                {isSubmitLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-8 text-center text-sm">
            <span className="text-muted-foreground">Don't have an account? </span>
            <Link
              to="/signup"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Start for free
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
