"use client"

import { useState } from "react"
import { Label } from "@/components/einui/label"
import {
  Users,
  DollarSign,
  TrendingUp,
  Activity,
  Plus,
  Search,
  MoreHorizontal,
  ArrowUpRight,
  ArrowDownRight,
  Settings,
  Bell,
  Shield,
  Database,
  Folder,
} from "lucide-react"
import { GlassTabs, GlassTabsContent, GlassTabsList, GlassTabsTrigger } from "@/components/einui/liquid-glass/glass-tabs"
import { GlassCard, GlassCardContent, GlassCardDescription, GlassCardHeader, GlassCardTitle } from "@/components/einui/liquid-glass/glass-card"
import { GlassInput } from "@/components/einui/liquid-glass/glass-input"
import { GlassButton } from "@/components/einui/liquid-glass/glass-button"
import { GlassAvatar, GlassAvatarFallback } from "@/components/einui/liquid-glass/glass-avatar"
import { GlassBadge } from "@/components/einui/liquid-glass/glass-badge"
import { GlassDialog, GlassDialogContent, GlassDialogDescription, GlassDialogFooter, GlassDialogHeader, GlassDialogTitle, GlassDialogTrigger } from "@/components/einui/liquid-glass/glass-dialog"
import { GlassProgress } from "@/components/einui/liquid-glass/glass-progress"


const stats = [
  { title: "Total Users", value: "12,456", change: "+12.5%", trend: "up", icon: Users },
  { title: "Revenue", value: "$54,321", change: "+8.2%", trend: "up", icon: DollarSign },
  { title: "Growth", value: "23.1%", change: "+4.3%", trend: "up", icon: TrendingUp },
  { title: "Active Now", value: "573", change: "-2.1%", trend: "down", icon: Activity },
]

const users = [
  { name: "Alice Johnson", email: "alice@example.com", role: "Admin", status: "active" },
  { name: "Bob Smith", email: "bob@example.com", role: "User", status: "active" },
  { name: "Carol Williams", email: "carol@example.com", role: "User", status: "pending" },
  { name: "David Brown", email: "david@example.com", role: "Moderator", status: "active" },
]

export default function AdminBlockPage() {
  const [searchQuery, setSearchQuery] = useState("")

  return (
    <div className="ein:w-full ein:space-y-6">
      {/* Stats Grid */}
      <div className="ein:grid ein:grid-cols-1 ein:sm:grid-cols-2 ein:lg:grid-cols-4 ein:gap-4">
        {stats.map((stat) => (
          <GlassCard key={stat.title}>
            <GlassCardContent className="ein:pt-6">
              <div className="ein:flex ein:items-start ein:justify-between">
                <div>
                  <p className="ein:text-sm ein:text-white/60 ein:mb-1">{stat.title}</p>
                  <p className="ein:text-2xl ein:font-bold ein:text-white">{stat.value}</p>
                  <div className="ein:flex ein:items-center ein:gap-1 ein:mt-1">
                    {stat.trend === "up" ? (
                      <ArrowUpRight className="ein:h-3 ein:w-3 ein:text-green-400" />
                    ) : (
                      <ArrowDownRight className="ein:h-3 ein:w-3 ein:text-red-400" />
                    )}
                    <span className={`ein:text-xs ${stat.trend === "up" ? "ein:text-green-400" : "ein:text-red-400"}`}>
                      {stat.change}
                    </span>
                  </div>
                </div>
                <div className="ein:p-2 ein:rounded-xl ein:bg-white/10">
                  <stat.icon className="ein:h-5 ein:w-5 ein:text-white/60" />
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="ein:grid ein:grid-cols-1 ein:lg:grid-cols-3 ein:gap-6">
        {/* Users Table */}
        <div className="ein:lg:col-span-2">
          <GlassCard>
            <GlassCardHeader>
              <div className="ein:flex ein:flex-col ein:sm:flex-row ein:sm:items-center ein:sm:justify-between ein:gap-4">
                <div>
                  <GlassCardTitle>Users</GlassCardTitle>
                  <GlassCardDescription>Manage your team members</GlassCardDescription>
                </div>
                <div className="ein:flex ein:items-center ein:gap-2">
                  <div className="ein:relative">
                    <Search className="ein:absolute ein:left-3 ein:top-1/2 ein:-translate-y-1/2 ein:h-4 ein:w-4 ein:text-white/70" />
                    <GlassInput
                      className="ein:pl-9 ein:w-full ein:sm:w-48"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <GlassDialog>
                    <GlassDialogTrigger asChild>
                      <GlassButton variant="primary" size="sm">
                        <Plus className="ein:h-4 ein:w-4 ein:mr-1" /> Add
                      </GlassButton>
                    </GlassDialogTrigger>
                    <GlassDialogContent>
                      <GlassDialogHeader>
                        <GlassDialogTitle>Add New User</GlassDialogTitle>
                        <GlassDialogDescription>Create a new user account.</GlassDialogDescription>
                      </GlassDialogHeader>
                      <div className="ein:space-y-4 ein:py-4">
                        <div className="ein:flex ein:flex-col ein:gap-2">
                          <Label className="ein:text-white/80">Name</Label>
                          <GlassInput placeholder="Full name" />
                        </div>
                        <div className="ein:flex ein:flex-col ein:gap-2">
                          <Label className="ein:text-white/80">Email</Label>
                          <GlassInput placeholder="email@example.com" />
                        </div>
                      </div>
                      <GlassDialogFooter>
                        <GlassButton variant="outline">Cancel</GlassButton>
                        <GlassButton variant="primary">Create User</GlassButton>
                      </GlassDialogFooter>
                    </GlassDialogContent>
                  </GlassDialog>
                </div>
              </div>
            </GlassCardHeader>
            <GlassCardContent>
              <div className="ein:overflow-x-auto">
                <table className="ein:w-full">
                  <thead>
                    <tr className="ein:border-b ein:border-white/10">
                      <th className="ein:text-left ein:py-3 ein:px-2 ein:text-xs ein:font-medium ein:text-white/70 ein:uppercase">User</th>
                      <th className="ein:text-left ein:py-3 ein:px-2 ein:text-xs ein:font-medium ein:text-white/70 ein:uppercase ein:hidden ein:sm:table-cell">
                        Role
                      </th>
                      <th className="ein:text-left ein:py-3 ein:px-2 ein:text-xs ein:font-medium ein:text-white/70 ein:uppercase">Status</th>
                      <th className="ein:py-3 ein:px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.email} className="ein:border-b ein:border-white/5 ein:hover:bg-white/5 ein:transition-colors">
                        <td className="ein:py-3 ein:px-2">
                          <div className="ein:flex ein:items-center ein:gap-3">
                            <GlassAvatar className="ein:h-8 ein:w-8">
                              <GlassAvatarFallback className="ein:text-xs">
                                {user.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </GlassAvatarFallback>
                            </GlassAvatar>
                            <div className="ein:min-w-0">
                              <p className="ein:text-sm ein:font-medium ein:text-white ein:truncate">{user.name}</p>
                              <p className="ein:text-xs ein:text-white/70 ein:truncate">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="ein:py-3 ein:px-2 ein:hidden ein:sm:table-cell">
                          <span className="ein:text-sm ein:text-white/70">{user.role}</span>
                        </td>
                        <td className="ein:py-3 ein:px-2">
                          <GlassBadge variant={user.status === "active" ? "success" : "warning"}>
                            {user.status}
                          </GlassBadge>
                        </td>
                        <td className="ein:py-3 ein:px-2">
                          <GlassButton variant="ghost" size="icon" className="ein:h-8 ein:w-8">
                            <MoreHorizontal className="ein:h-4 ein:w-4" />
                          </GlassButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>

        {/* Sidebar Widgets */}
        <div className="ein:space-y-6">
          {/* Storage */}
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="ein:flex ein:items-center ein:gap-2">
                <Database className="ein:h-4 ein:w-4" /> Storage
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <GlassProgress value={68} className="ein:mb-3" />
              <div className="ein:flex ein:justify-between ein:text-sm">
                <span className="ein:text-white/60">68.5 GB used</span>
                <span className="ein:text-white/70">100 GB</span>
              </div>
              <div className="ein:mt-4 ein:space-y-2">
                <div className="ein:flex ein:items-center ein:justify-between ein:text-sm">
                  <div className="ein:flex ein:items-center ein:gap-2">
                    <Folder className="ein:h-4 ein:w-4 ein:text-cyan-400" />
                    <span className="ein:text-white/70">Documents</span>
                  </div>
                  <span className="ein:text-white/70">24.5 GB</span>
                </div>
                <div className="ein:flex ein:items-center ein:justify-between ein:text-sm">
                  <div className="ein:flex ein:items-center ein:gap-2">
                    <Folder className="ein:h-4 ein:w-4 ein:text-purple-400" />
                    <span className="ein:text-white/70">Media</span>
                  </div>
                  <span className="ein:text-white/70">32.1 GB</span>
                </div>
                <div className="ein:flex ein:items-center ein:justify-between ein:text-sm">
                  <div className="ein:flex ein:items-center ein:gap-2">
                    <Folder className="ein:h-4 ein:w-4 ein:text-blue-400" />
                    <span className="ein:text-white/70">Backups</span>
                  </div>
                  <span className="ein:text-white/70">11.9 GB</span>
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>

          {/* Activity */}
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle>Recent Activity</GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <div className="ein:space-y-4">
                {[
                  { action: "User signed up", time: "2 min ago" },
                  { action: "New order #1234", time: "15 min ago" },
                  { action: "Payment received", time: "1 hour ago" },
                  { action: "Server backup completed", time: "3 hours ago" },
                ].map((item, i) => (
                  <div key={i} className="ein:flex ein:items-center ein:gap-3">
                    <div className="ein:h-2 ein:w-2 ein:rounded-full ein:bg-cyan-400" />
                    <div className="ein:flex-1 ein:min-w-0">
                      <p className="ein:text-sm ein:text-white/80 ein:truncate">{item.action}</p>
                      <p className="ein:text-xs ein:text-white/70">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>
      </div>

      {/* Settings Tabs */}
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle>Settings</GlassCardTitle>
          <GlassCardDescription>Manage your application preferences</GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent>
          <GlassTabs defaultValue="general">
            <GlassTabsList className="ein:w-full ein:flex-wrap">
              <GlassTabsTrigger value="general" className="ein:flex-1">
                <Settings className="ein:h-4 ein:w-4 ein:mr-2" /> General
              </GlassTabsTrigger>
              <GlassTabsTrigger value="notifications" className="ein:flex-1">
                <Bell className="ein:h-4 ein:w-4 ein:mr-2" /> Notifications
              </GlassTabsTrigger>
              <GlassTabsTrigger value="security" className="ein:flex-1">
                <Shield className="ein:h-4 ein:w-4 ein:mr-2" /> Security
              </GlassTabsTrigger>
            </GlassTabsList>
            <GlassTabsContent value="general">
              <div className="ein:space-y-4">
                <div className="ein:flex ein:flex-col ein:gap-2">
                  <Label className="ein:text-white/80">Site Name</Label>
                  <GlassInput defaultValue="Ein Dashboard" />
                </div>
                <div className="ein:flex ein:flex-col ein:gap-2">
                  <Label className="ein:text-white/80">Support Email</Label>
                  <GlassInput defaultValue="support@ein.dev" />
                </div>
                <GlassButton variant="primary">Save Changes</GlassButton>
              </div>
            </GlassTabsContent>
            <GlassTabsContent value="notifications">
              <div className="ein:space-y-3">
                <div className="ein:flex ein:items-center ein:justify-between ein:p-3 ein:rounded-lg ein:bg-white/5">
                  <span className="ein:text-white/80 ein:text-sm">Email notifications</span>
                  <div className="ein:w-10 ein:h-6 ein:bg-cyan-500/50 ein:rounded-full ein:relative">
                    <div className="ein:absolute ein:right-0.5 ein:top-0.5 ein:w-5 ein:h-5 ein:bg-white ein:rounded-full" />
                  </div>
                </div>
                <div className="ein:flex ein:items-center ein:justify-between ein:p-3 ein:rounded-lg ein:bg-white/5">
                  <span className="ein:text-white/80 ein:text-sm">Push notifications</span>
                  <div className="ein:w-10 ein:h-6 ein:bg-white/20 ein:rounded-full ein:relative">
                    <div className="ein:absolute ein:left-0.5 ein:top-0.5 ein:w-5 ein:h-5 ein:bg-white/60 ein:rounded-full" />
                  </div>
                </div>
                <div className="ein:flex ein:items-center ein:justify-between ein:p-3 ein:rounded-lg ein:bg-white/5">
                  <span className="ein:text-white/80 ein:text-sm">Weekly digest</span>
                  <div className="ein:w-10 ein:h-6 ein:bg-cyan-500/50 ein:rounded-full ein:relative">
                    <div className="ein:absolute ein:right-0.5 ein:top-0.5 ein:w-5 ein:h-5 ein:bg-white ein:rounded-full" />
                  </div>
                </div>
              </div>
            </GlassTabsContent>
            <GlassTabsContent value="security">
              <div className="ein:space-y-4">
                <div className="ein:flex ein:flex-col ein:gap-2">
                  <Label className="ein:text-white/80">Current Password</Label>
                  <GlassInput type="password" placeholder="••••••••" />
                </div>
                <div className="ein:flex ein:flex-col ein:gap-2">
                  <Label className="ein:text-white/80">New Password</Label>
                  <GlassInput type="password" placeholder="••••••••" />
                </div>
                <GlassButton variant="primary">Update Password</GlassButton>
              </div>
            </GlassTabsContent>
          </GlassTabs>
        </GlassCardContent>
      </GlassCard>
    </div>
  )
}
