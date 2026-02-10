"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TeamHealthMetrics, StaffingSummary } from "@/lib/ministry-teams/service";

interface TeamHealthDashboardProps {
  healthMetrics: TeamHealthMetrics[];
  staffingSummary: StaffingSummary;
}

export function TeamHealthDashboard({
  healthMetrics,
  staffingSummary,
}: TeamHealthDashboardProps) {
  const redAlerts = healthMetrics.filter((m) => m.alertLevel === "red");
  const yellowAlerts = healthMetrics.filter((m) => m.alertLevel === "yellow");
  const healthyTeams = healthMetrics.filter((m) => m.alertLevel === "green");

  // Prepare radar chart data
  const radarData = healthMetrics.map((m) => ({
    team: m.teamName.length > 12 ? m.teamName.slice(0, 12) + "..." : m.teamName,
    staffing: m.staffingPercent,
    training: m.trainingPercent,
    attendance: m.meetingAttendancePercent,
    fullName: m.teamName,
  }));

  const averageEngagement =
    healthMetrics.length > 0
      ? Math.round(
          healthMetrics.reduce((sum, m) => sum + m.engagementScore, 0) /
            healthMetrics.length
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Teams"
          value={staffingSummary.totalTeams.toString()}
          description="Ministry teams"
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <SummaryCard
          title="Staffing"
          value={`${staffingSummary.staffingPercentage}%`}
          description={`${staffingSummary.filledRoles}/${staffingSummary.totalRoles} roles`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <SummaryCard
          title="Engagement"
          value={`${averageEngagement}%`}
          description="Avg. engagement score"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <SummaryCard
          title="Alerts"
          value={(redAlerts.length + yellowAlerts.length).toString()}
          description={`${redAlerts.length} critical, ${yellowAlerts.length} warnings`}
          icon={<AlertTriangle className="h-4 w-4" />}
          alert={redAlerts.length > 0}
        />
      </div>

      {/* Alerts Section */}
      {(redAlerts.length > 0 || yellowAlerts.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Teams Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {redAlerts.map((m) => (
                <AlertRow key={m.teamId} metrics={m} />
              ))}
              {yellowAlerts.map((m) => (
                <AlertRow key={m.teamId} metrics={m} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Radar Chart */}
        {healthMetrics.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Team Health Comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="team" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                    />
                    <Radar
                      name="Staffing"
                      dataKey="staffing"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.15}
                    />
                    <Radar
                      name="Training"
                      dataKey="training"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.15}
                    />
                    <Radar
                      name="Attendance"
                      dataKey="attendance"
                      stroke="#a855f7"
                      fill="#a855f7"
                      fillOpacity={0.15}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex justify-center gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Staffing
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Training
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-purple-500" />
                  Attendance
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Team Health List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {healthMetrics.map((m) => (
                <Link
                  key={m.teamId}
                  href={`/teams/${m.teamId}`}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      m.alertLevel === "red" && "bg-red-500",
                      m.alertLevel === "yellow" && "bg-yellow-500",
                      m.alertLevel === "green" && "bg-green-500"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.teamName}
                    </p>
                    <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                      <span>Staffing: {m.staffingPercent}%</span>
                      <span>Training: {m.trainingPercent}%</span>
                      <span>Attendance: {m.meetingAttendancePercent}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {m.engagementScore}%
                    </Badge>
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon,
  alert = false,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm font-medium">
            {title}
          </span>
          <span
            className={cn(
              "text-muted-foreground",
              alert && "text-red-500"
            )}
          >
            {icon}
          </span>
        </div>
        <p
          className={cn(
            "mt-2 text-2xl font-bold",
            alert && "text-red-500"
          )}
        >
          {value}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </CardContent>
    </Card>
  );
}

function AlertRow({ metrics }: { metrics: TeamHealthMetrics }) {
  const issues: string[] = [];
  if (metrics.staffingPercent < 40) issues.push("Critical: Staffing below 40%");
  else if (metrics.staffingPercent < 60) issues.push("Warning: Staffing below 60%");
  if (metrics.meetingAttendancePercent < 50)
    issues.push("Warning: Attendance below 50%");

  return (
    <Link
      href={`/teams/${metrics.teamId}`}
      className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
    >
      <span
        className={cn(
          "h-3 w-3 shrink-0 rounded-full",
          metrics.alertLevel === "red" && "bg-red-500",
          metrics.alertLevel === "yellow" && "bg-yellow-500"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{metrics.teamName}</p>
        <div className="text-muted-foreground mt-0.5 space-x-2 text-xs">
          {issues.map((issue, i) => (
            <span key={i}>{issue}</span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Progress
          value={metrics.staffingPercent}
          className="h-2 w-16"
        />
        <span className="text-muted-foreground text-xs">
          {metrics.staffingPercent}%
        </span>
      </div>
    </Link>
  );
}
