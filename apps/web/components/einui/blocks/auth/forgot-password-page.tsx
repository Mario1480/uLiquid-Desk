"use client"

import { useState } from "react"
import { Mail, ArrowLeft, Send } from "lucide-react"
import { GlassCard, GlassCardContent, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/einui/liquid-glass/glass-card"
import { GlassInput } from "@/components/einui/liquid-glass/glass-input"
import { GlassButton } from "@/components/einui/liquid-glass/glass-button"
import { Label } from "@/components/einui/label"

export default function ForgotPasswordPageBlock() {
  const [email, setEmail] = useState("")
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsLoading(false)
    setIsSubmitted(true)
  }

  const handleBack = () => {
    setIsSubmitted(false)
    setEmail("")
  }

  return (
    <div className="ein:h-full ein:flex ein:py-14 ein:items-center ein:justify-center ein:bg-linear-to-br ein:from-slate-950 ein:via-purple-900 ein:to-slate-950 ein:px-4">
      <GlassCard className="ein:w-full ein:max-w-md">
        {!isSubmitted ? (
          <>
            <GlassCardHeader className="ein:space-y-2 ein:text-center">
              <div className="ein:flex ein:justify-center ein:mb-4">
                <div className="ein:p-3 ein:rounded-lg ein:bg-linear-to-br ein:from-orange-400 ein:to-red-500">
                  <Mail className="ein:h-6 ein:w-6 ein:text-white" />
                </div>
              </div>
              <GlassCardTitle className="ein:text-2xl">Forgot Password?</GlassCardTitle>
              <GlassCardDescription>
                No problem! Enter your email and we&apos;ll send you a link to reset your password.
              </GlassCardDescription>
            </GlassCardHeader>

            <GlassCardContent>
              <form onSubmit={handleSubmit} className="ein:space-y-5">
                {/* Email Input */}
                <div className="ein:space-y-2">
                  <Label htmlFor="email" className="ein:text-white/80">
                    Email Address
                  </Label>
                  <GlassInput
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="ein:bg-white/5"
                  />
                  <p className="ein:text-xs ein:text-white/70 ein:mt-1">
                    We&apos;ll send a password reset link to this email address.
                  </p>
                </div>

                {/* Submit Button */}
                <GlassButton type="submit" variant="primary" className="ein:w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <div className="ein:h-4 ein:w-4 ein:rounded-full ein:border-2 ein:border-white/30 ein:border-t-white ein:animate-spin ein:mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="ein:h-4 ein:w-4 ein:mr-2" />
                      Send Reset Link
                    </>
                  )}
                </GlassButton>

                {/* Back to Login */}
                <button
                  type="button"
                  onClick={handleBack}
                  className="ein:w-full ein:flex ein:items-center ein:justify-center ein:text-sm ein:text-cyan-400 ein:hover:text-cyan-300 ein:transition-colors"
                >
                  <ArrowLeft className="ein:h-4 ein:w-4 ein:mr-2" />
                  Back to Sign In
                </button>
              </form>
            </GlassCardContent>
          </>
        ) : (
          <>
            <GlassCardHeader className="ein:space-y-2 ein:text-center">
              <div className="ein:flex ein:justify-center ein:mb-4">
                <div className="ein:p-3 ein:rounded-lg ein:bg-linear-to-br ein:from-green-400 ein:to-emerald-500">
                  <Mail className="ein:h-6 ein:w-6 ein:text-white" />
                </div>
              </div>
              <GlassCardTitle className="ein:text-2xl">Check Your Email</GlassCardTitle>
              <GlassCardDescription>
                We&apos;ve sent a password reset link to{" "}
                <span className="ein:font-medium ein:text-white/90">{email}</span>
              </GlassCardDescription>
            </GlassCardHeader>

            <GlassCardContent className="ein:space-y-6">
              {/* Success Message */}
              <div className="ein:p-4 ein:rounded-lg ein:bg-green-500/10 ein:border ein:border-green-500/20">
                <p className="ein:text-sm ein:text-green-400">
                  Please check your email and follow the instructions to reset your password. The link expires in 24 hours.
                </p>
              </div>

              {/* Helpful Tips */}
              <div className="ein:space-y-3">
                <h3 className="ein:text-sm ein:font-medium ein:text-white/80">Didn&apos;t receive the email?</h3>
                <ul className="ein:space-y-2 ein:text-xs ein:text-white/60">
                  <li className="ein:flex ein:gap-2">
                    <span className="ein:text-cyan-400">•</span>
                    <span>Check your spam or junk folder</span>
                  </li>
                  <li className="ein:flex ein:gap-2">
                    <span className="ein:text-cyan-400">•</span>
                    <span>Make sure you entered the correct email address</span>
                  </li>
                  <li className="ein:flex ein:gap-2">
                    <span className="ein:text-cyan-400">•</span>
                    <span>Try using a different email address if you have one on file</span>
                  </li>
                </ul>
              </div>

              {/* Resend Option */}
              <div className="ein:flex ein:gap-2">
                <GlassButton
                  type="button"
                  variant="outline"
                  className="ein:flex-1"
                  onClick={handleBack}
                >
                  Try Different Email
                </GlassButton>
                <GlassButton
                  type="button"
                  variant="primary"
                  className="ein:flex-1"
                  disabled={isLoading}
                  onClick={handleSubmit}
                >
                  {isLoading ? (
                    <div className="ein:h-4 ein:w-4 ein:rounded-full ein:border-2 ein:border-white/30 ein:border-t-white ein:animate-spin" />
                  ) : (
                    "Resend Email"
                  )}
                </GlassButton>
              </div>

              {/* Contact Support */}
              <p className="ein:text-center ein:text-xs ein:text-white/70 ein:pt-4 ein:border-t ein:border-white/10">
                Still need help?{" "}
                <a href="#" className="ein:text-cyan-400 ein:hover:text-cyan-300 ein:transition-colors">
                  Contact support
                </a>
              </p>
            </GlassCardContent>
          </>
        )}
      </GlassCard>
    </div>
  )
}
