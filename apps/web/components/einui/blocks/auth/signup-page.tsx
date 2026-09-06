"use client"

import { useMemo, useState } from "react"
import { Eye, EyeOff, UserPlus, Check } from "lucide-react"
import { GlassCard, GlassCardContent, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/einui/liquid-glass/glass-card"
import { GlassInput } from "@/components/einui/liquid-glass/glass-input"
import { GlassButton } from "@/components/einui/liquid-glass/glass-button"
import { GlassCheckbox } from "@/components/einui/liquid-glass/glass-checkbox"
import { Label } from "@/components/einui/label"

interface ValidationRules {
  minLength: boolean
  hasUpperCase: boolean
  hasLowerCase: boolean
  hasNumber: boolean
  hasSpecial: boolean
}

export default function SignupPageBlock() {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [agreeToTerms, setAgreeToTerms] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const validatePassword = (pwd: string): ValidationRules => ({
    minLength: pwd.length >= 8,
    hasUpperCase: /[A-Z]/.test(pwd),
    hasLowerCase: /[a-z]/.test(pwd),
    hasNumber: /\d/.test(pwd),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
  })

  const validation = useMemo(() => validatePassword(password), [password])
  const isPasswordValid = Object.values(validation).every(Boolean)
  const passwordsMatch = password === confirmPassword && password.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isPasswordValid || !passwordsMatch || !agreeToTerms) return

    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsLoading(false)
    console.log({ firstName, lastName, email, password })
  }

  return (
    <div className=" ein:flex ein:items-center ein:justify-center ein:bg-linear-to-br ein:from-slate-950 ein:via-purple-900 ein:to-slate-950 ein:px-4 ein:py-8">
      <GlassCard className="ein:w-full ein:max-w-md">
        <GlassCardHeader className="ein:space-y-2 ein:text-center">
          <div className="ein:flex ein:justify-center ein:mb-2">
            <div className="ein:p-2 ein:rounded-lg ein:bg-linear-to-br ein:from-green-400 ein:to-emerald-500">
              <UserPlus className="ein:h-6 ein:w-6 ein:text-white" />
            </div>
          </div>
          <GlassCardTitle className="ein:text-2xl">Create Account</GlassCardTitle>
          <GlassCardDescription>Join us today and get started</GlassCardDescription>
        </GlassCardHeader>

        <GlassCardContent>
          <form onSubmit={handleSubmit} className="ein:space-y-4">
            {/* Name Fields */}
            <div className="ein:grid ein:grid-cols-2 ein:gap-3">
              <div className="ein:space-y-2">
                <Label htmlFor="firstName" className="ein:text-white/80">
                  First Name
                </Label>
                <GlassInput
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="ein:bg-white/5"
                />
              </div>
              <div className="ein:space-y-2">
                <Label htmlFor="lastName" className="ein:text-white/80">
                  Last Name
                </Label>
                <GlassInput
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="ein:bg-white/5"
                />
              </div>
            </div>

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
            </div>

            {/* Password Input */}
            <div className="ein:space-y-2">
              <Label htmlFor="password" className="ein:text-white/80">
                Password
              </Label>
              <div className="ein:relative">
                <GlassInput
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="ein:bg-white/5 ein:pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="ein:absolute ein:right-3 ein:top-1/2 ein:-translate-y-1/2 ein:text-white/70 ein:hover:text-white/60 ein:transition-colors"
                >
                  {showPassword ? <EyeOff className="ein:h-4 ein:w-4" /> : <Eye className="ein:h-4 ein:w-4" />}
                </button>
              </div>
              {/* Password Strength Indicator */}
              {password.length > 0 && (
                <div className="ein:space-y-2 ein:p-3 ein:rounded-lg ein:bg-white/5 ein:border ein:border-white/10">
                  <p className="ein:text-xs ein:font-medium ein:text-white/60 ein:mb-2">Password requirements:</p>
                  <div className="ein:grid ein:grid-cols-2 ein:gap-1.5">
                    {[
                      { key: "minLength", label: "8+ characters" },
                      { key: "hasUpperCase", label: "Uppercase letter" },
                      { key: "hasLowerCase", label: "Lowercase letter" },
                      { key: "hasNumber", label: "Number" },
                      { key: "hasSpecial", label: "Special character" },
                    ].map((rule) => (
                      <div key={rule.key} className="ein:flex ein:items-center ein:gap-1.5">
                        <div className={`ein:h-1.5 ein:w-1.5 ein:rounded-full ein:transition-colors ${validation[rule.key as keyof ValidationRules] ? "ein:bg-green-400" : "ein:bg-white/20"
                          }`} />
                        <span className={`ein:text-xs ein:transition-colors ${validation[rule.key as keyof ValidationRules] ? "ein:text-green-400" : "ein:text-white/70"
                          }`}>
                          {rule.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="ein:space-y-2">
              <Label htmlFor="confirmPassword" className="ein:text-white/80">
                Confirm Password
              </Label>
              <div className="ein:relative">
                <GlassInput
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={!isPasswordValid}
                  className="ein:bg-white/5 ein:pr-10 ein:disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="ein:absolute ein:right-3 ein:top-1/2 ein:-translate-y-1/2 ein:text-white/70 ein:hover:text-white/60 ein:transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="ein:h-4 ein:w-4" /> : <Eye className="ein:h-4 ein:w-4" />}
                </button>
              </div>
              {passwordsMatch && isPasswordValid && (
                <div className="ein:flex ein:items-center ein:gap-2 ein:text-xs ein:text-green-400">
                  <Check className="ein:h-3 ein:w-3" /> Passwords match
                </div>
              )}
            </div>

            {/* Terms Agreement */}
            <div className="ein:flex ein:items-start ein:gap-3 ein:pt-2">
              <div className="ein:pt-1">
                <GlassCheckbox id="terms" checked={agreeToTerms} onCheckedChange={(checked) => {
                  if (typeof checked === 'boolean') {
                    setAgreeToTerms(checked)
                  }
                }} />
              </div>
              <Label htmlFor="terms" className="ein:text-white/70 ein:cursor-pointer ein:text-sm ein:leading-relaxed ein:font-normal ein:flex-1 ein:flex ein:flex-wrap ein:gap-x-1 ein:gap-y-0.5">
                <span className="ein:whitespace-nowrap">
                  I agree to the{" "}
                  <a href="#" className="ein:text-cyan-400 ein:hover:text-cyan-300 ein:transition-colors">
                    Terms of Service
                  </a>
                </span>
                <span className="ein:whitespace-nowrap">
                  and{" "}
                  <a href="#" className="ein:text-cyan-400 ein:hover:text-cyan-300 ein:transition-colors">
                    Privacy Policy
                  </a>
                </span>
              </Label>
            </div>

            {/* Submit Button */}
            <GlassButton
              type="submit"
              variant="primary"
              className="ein:w-full ein:mt-6"
              disabled={isLoading || !isPasswordValid || !passwordsMatch || !agreeToTerms}
            >
              {isLoading ? (
                <>
                  <div className="ein:h-4 ein:w-4 ein:rounded-full ein:border-2 ein:border-white/30 ein:border-t-white ein:animate-spin ein:mr-2" />
                  Creating account...
                </>
              ) : (
                <>
                  <UserPlus className="ein:h-4 ein:w-4 ein:mr-2" />
                  Sign Up
                </>
              )}
            </GlassButton>

            {/* Sign In Link */}
            <p className="ein:text-center ein:text-sm ein:text-white/60">
              Already have an account?{" "}
              <a href="#" className="ein:text-cyan-400 ein:hover:text-cyan-300 ein:transition-colors ein:font-medium">
                Sign in
              </a>
            </p>
          </form>
        </GlassCardContent>
      </GlassCard>
    </div>
  )
}
