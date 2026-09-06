"use client"

import { BarChart3, TrendingUp, Users, Zap, ArrowUpRight, ArrowDownRight, Clock, CheckCircle2, XCircle } from "lucide-react"
import { GlassCard, GlassCardContent, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/einui/liquid-glass/glass-card"
import { GlassButton } from "@/components/einui/liquid-glass/glass-button"
import { GlassBadge } from "@/components/einui/liquid-glass/glass-badge"
import { GlassProgress } from "@/components/einui/liquid-glass/glass-progress"
import { GlassAvatar, GlassAvatarFallback, GlassAvatarImage } from "@/components/einui/liquid-glass/glass-avatar"

const stats = [
  { label: "Total Revenue", value: "$45,231", change: "+20.1%", trend: "up", icon: TrendingUp, color: "ein:from-green-400 ein:to-emerald-500" },
  { label: "Active Users", value: "2,345", change: "+15%", trend: "up", icon: Users, color: "ein:from-blue-400 ein:to-cyan-500" },
  { label: "Performance", value: "94.2%", change: "+5.2%", trend: "up", icon: Zap, color: "ein:from-yellow-400 ein:to-orange-500" },
  { label: "Conversions", value: "1,234", change: "-2.4%", trend: "down", icon: BarChart3, color: "ein:from-purple-400 ein:to-pink-500" },
]

const recentActivity = [
  { id: 1, user: "Sarah Anderson", avatar: "", action: "completed task", target: "Homepage redesign", time: "2 min ago", status: "success" },
  { id: 2, user: "Mike Chen", avatar: "", action: "started working on", target: "API integration", time: "15 min ago", status: "info" },
  { id: 3, user: "Emma Watson", avatar: "", action: "commented on", target: "Bug fix #234", time: "1 hour ago", status: "info" },
  { id: 4, user: "John Smith", avatar: "", action: "closed issue", target: "Performance optimization", time: "3 hours ago", status: "success" },
  { id: 5, user: "Lisa Park", avatar: "", action: "reopened", target: "Login flow issue", time: "5 hours ago", status: "warning" },
]

const projects = [
  { name: "Mobile App v2.0", progress: 85, status: "On Track", deadline: "Jan 15", team: ["SA", "MC", "JP"] },
  { name: "API Documentation", progress: 60, status: "At Risk", deadline: "Jan 20", team: ["EW", "JS"] },
  { name: "Dashboard Redesign", progress: 100, status: "Completed", deadline: "Dec 30", team: ["LP", "SA", "MC", "EW"] },
  { name: "Security Audit", progress: 35, status: "On Track", deadline: "Feb 1", team: ["JS", "JP"] },
]

const chartData = [
  { day: "Mon", value: 65 },
  { day: "Tue", value: 45 },
  { day: "Wed", value: 75 },
  { day: "Thu", value: 55 },
  { day: "Fri", value: 85 },
  { day: "Sat", value: 40 },
  { day: "Sun", value: 70 },
]

export default function DashboardBlockPage() {
  return (
    <div className="ein:w-full ein:space-y-6">
      {/* Stats Grid */}
      <div className="ein:grid ein:grid-cols-1 ein:sm:grid-cols-2 ein:lg:grid-cols-4 ein:gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <GlassCard key={stat.label} className="ein:group ein:hover:scale-[1.02] ein:transition-transform ein:duration-300">
              <GlassCardContent className="ein:pt-6">
                <div className="ein:flex ein:items-start ein:justify-between">
                  <div className="ein:space-y-1">
                    <p className="ein:text-sm ein:text-white/60">{stat.label}</p>
                    <p className="ein:text-2xl ein:font-bold ein:text-white">{stat.value}</p>
                    <div className="ein:flex ein:items-center ein:gap-1">
                      {stat.trend === "up" ? (
                        <ArrowUpRight className="ein:h-3 ein:w-3 ein:text-green-400" />
                      ) : (
                        <ArrowDownRight className="ein:h-3 ein:w-3 ein:text-red-400" />
                      )}
                      <span className={`ein:text-xs ein:font-medium ${stat.trend === "up" ? "ein:text-green-400" : "ein:text-red-400"}`}>
                        {stat.change}
                      </span>
                      <span className="ein:text-xs ein:text-white/70">vs last month</span>
                    </div>
                  </div>
                  <div className={`ein:p-3 ein:rounded-xl ein:bg-linear-to-br ${stat.color} ein:shadow-lg`}>
                    <Icon className="ein:h-5 ein:w-5 ein:text-white" />
                  </div>
                </div>
              </GlassCardContent>
            </GlassCard>
          )
        })}
      </div>

      {/* Main Content Grid */}
      <div className="ein:grid ein:grid-cols-1 ein:lg:grid-cols-3 ein:gap-6">
        {/* Chart Card */}
        <div className="ein:lg:col-span-2">
          <GlassCard className="ein:h-full">
            <GlassCardHeader>
              <div className="ein:flex ein:items-center ein:justify-between">
                <div>
                  <GlassCardTitle>Revenue Overview</GlassCardTitle>
                  <GlassCardDescription>Weekly performance metrics</GlassCardDescription>
                </div>
                <div className="ein:flex ein:gap-2">
                  <GlassButton variant="ghost" size="sm">Week</GlassButton>
                  <GlassButton variant="outline" size="sm">Month</GlassButton>
                  <GlassButton variant="ghost" size="sm">Year</GlassButton>
                </div>
              </div>
            </GlassCardHeader>
            <GlassCardContent>
              <div className="ein:h-64 ein:flex ein:items-end ein:justify-between ein:gap-3 ein:px-2">
                {chartData.map((item, i) => (
                  <div key={i} className="ein:flex-1 ein:flex ein:flex-col ein:items-center ein:gap-2">
                    <div className="ein:w-full ein:relative ein:group">
                      <div
                        className="ein:w-full ein:rounded-t-lg ein:bg-linear-to-t ein:from-cyan-500 ein:to-blue-500 ein:transition-all ein:duration-300 ein:hover:from-cyan-400 ein:hover:to-blue-400 ein:cursor-pointer"
                        style={{ height: `${item.value * 2}px` }}
                      />
                      <div className="ein:absolute ein:-top-8 ein:left-1/2 ein:-translate-x-1/2 ein:opacity-0 ein:group-hover:opacity-100 ein:transition-opacity ein:bg-white/10 ein:backdrop-blur-sm ein:px-2 ein:py-1 ein:rounded ein:text-xs ein:text-white ein:whitespace-nowrap">
                        ${(item.value * 100).toLocaleString()}
                      </div>
                    </div>
                    <span className="ein:text-xs ein:text-white/70">{item.day}</span>
                  </div>
                ))}
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>

        {/* Quick Actions */}
        <GlassCard>
          <GlassCardHeader>
            <GlassCardTitle>Quick Actions</GlassCardTitle>
            <GlassCardDescription>Common tasks at a glance</GlassCardDescription>
          </GlassCardHeader>
          <GlassCardContent className="ein:space-y-3">
            <GlassButton variant="primary" className="ein:w-full ein:justify-center">
              <TrendingUp className="ein:h-4 ein:w-4 ein:mr-2" />
              Generate Report
            </GlassButton>
            <GlassButton variant="outline" className="ein:w-full ein:justify-center">
              <Users className="ein:h-4 ein:w-4 ein:mr-2" />
              Invite Team Member
            </GlassButton>
            <GlassButton variant="outline" className="ein:w-full ein:justify-center">
              <BarChart3 className="ein:h-4 ein:w-4 ein:mr-2" />
              Export Analytics
            </GlassButton>
            <GlassButton variant="ghost" className="ein:w-full ein:justify-center">
              <Clock className="ein:h-4 ein:w-4 ein:mr-2" />
              Schedule Meeting
            </GlassButton>
          </GlassCardContent>
        </GlassCard>
      </div>

      {/* Bottom Grid */}
      <div className="ein:grid ein:grid-cols-1 ein:lg:grid-cols-2 ein:gap-6">
        {/* Recent Activity */}
        <GlassCard>
          <GlassCardHeader>
            <div className="ein:flex ein:items-center ein:justify-between">
              <div>
                <GlassCardTitle>Recent Activity</GlassCardTitle>
                <GlassCardDescription>Latest updates from your team</GlassCardDescription>
              </div>
              <GlassButton variant="ghost" size="sm">View All</GlassButton>
            </div>
          </GlassCardHeader>
          <GlassCardContent>
            <div className="ein:space-y-4">
              {recentActivity.map((item) => (
                <div key={item.id} className="ein:flex ein:items-start ein:gap-3 ein:p-2 ein:rounded-lg ein:hover:bg-white/5 ein:transition-colors">
                  <GlassAvatar className="ein:h-8 ein:w-8">
                    <GlassAvatarImage src={item.avatar} />
                    <GlassAvatarFallback className="ein:text-xs ein:bg-linear-to-br ein:from-cyan-400 ein:to-blue-500">
                      {item.user.split(" ").map((n) => n[0]).join("")}
                    </GlassAvatarFallback>
                  </GlassAvatar>
                  <div className="ein:flex-1 ein:min-w-0">
                    <p className="ein:text-sm ein:text-white/80">
                      <span className="ein:font-medium ein:text-white">{item.user}</span>{" "}
                      {item.action}{" "}
                      <span className="ein:text-cyan-400">{item.target}</span>
                    </p>
                    <p className="ein:text-xs ein:text-white/70 ein:mt-0.5">{item.time}</p>
                  </div>
                  {item.status === "success" && <CheckCircle2 className="ein:h-4 ein:w-4 ein:text-green-400 ein:shrink-0" />}
                  {item.status === "warning" && <XCircle className="ein:h-4 ein:w-4 ein:text-yellow-400 ein:shrink-0" />}
                </div>
              ))}
            </div>
          </GlassCardContent>
        </GlassCard>

        {/* Active Projects */}
        <GlassCard>
          <GlassCardHeader>
            <div className="ein:flex ein:items-center ein:justify-between">
              <div>
                <GlassCardTitle>Active Projects</GlassCardTitle>
                <GlassCardDescription>Track your team&apos;s progress</GlassCardDescription>
              </div>
              <GlassButton variant="ghost" size="sm">View All</GlassButton>
            </div>
          </GlassCardHeader>
          <GlassCardContent className="ein:space-y-5">
            {projects.map((project) => (
              <div key={project.name} className="ein:space-y-3">
                <div className="ein:flex ein:items-center ein:justify-between">
                  <div className="ein:flex ein:items-center ein:gap-3">
                    <p className="ein:text-sm ein:font-medium ein:text-white">{project.name}</p>
                    <GlassBadge
                      variant={
                        project.status === "Completed" ? "success" :
                        project.status === "At Risk" ? "warning" : "default"
                      }
                      className="ein:text-xs"
                    >
                      {project.status}
                    </GlassBadge>
                  </div>
                  <div className="ein:flex ein:-space-x-2">
                    {project.team.slice(0, 3).map((member, i) => (
                      <GlassAvatar key={i} className="ein:h-6 ein:w-6 ein:border-2 ein:border-slate-900">
                        <GlassAvatarFallback className="ein:text-[10px] ein:bg-linear-to-br ein:from-purple-400 ein:to-pink-500">
                          {member}
                        </GlassAvatarFallback>
                      </GlassAvatar>
                    ))}
                    {project.team.length > 3 && (
                      <div className="ein:h-6 ein:w-6 ein:rounded-full ein:bg-white/10 ein:flex ein:items-center ein:justify-center ein:text-[10px] ein:text-white/60 ein:border-2 ein:border-slate-900">
                        +{project.team.length - 3}
                      </div>
                    )}
                  </div>
                </div>
                <div className="ein:space-y-1">
                  <GlassProgress value={project.progress} className="ein:h-2" />
                  <div className="ein:flex ein:justify-between ein:text-xs">
                    <span className="ein:text-white/70">{project.progress}% complete</span>
                    <span className="ein:text-white/70">Due {project.deadline}</span>
                  </div>
                </div>
              </div>
            ))}
          </GlassCardContent>
        </GlassCard>
      </div>
    </div>
  )
}
