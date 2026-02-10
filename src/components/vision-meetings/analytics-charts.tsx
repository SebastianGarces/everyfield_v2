"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AttendanceTrendPoint,
  MeetingSummaryStats,
} from "@/lib/vision-meetings/types";
import {
  BarChart3,
  CalendarCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AnalyticsChartsProps {
  trend: AttendanceTrendPoint[];
  stats: MeetingSummaryStats;
  currentMeetingId?: string;
}

export function AnalyticsCharts({
  trend,
  stats,
  currentMeetingId,
}: AnalyticsChartsProps) {
  const chartData = trend.map((point) => ({
    name: `#${point.meetingNumber}`,
    total: point.totalAttendance,
    new: point.newAttendees,
    returning: point.returningAttendees,
    coreGroup: point.coreGroupAttendees,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CalendarCheck className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm">Total Meetings</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{stats.totalMeetings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm">Avg Attendance</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{stats.avgAttendance}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="text-muted-foreground h-4 w-4" />
              <p className="text-muted-foreground text-sm">Last Meeting</p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {stats.lastMeetingAttendance ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              {stats.growthPercent !== null && stats.growthPercent >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <p className="text-muted-foreground text-sm">Growth</p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {stats.growthPercent !== null
                ? `${stats.growthPercent > 0 ? "+" : ""}${stats.growthPercent}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Trend Line Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New vs Returning Stacked Bar Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New vs Returning</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="new"
                    name="First Time"
                    stackId="a"
                    fill="#22c55e"
                  />
                  <Bar
                    dataKey="returning"
                    name="Returning"
                    stackId="a"
                    fill="#3b82f6"
                  />
                  <Bar
                    dataKey="coreGroup"
                    name="Core Group"
                    stackId="a"
                    fill="#a855f7"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {chartData.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="text-muted-foreground/50 mx-auto h-12 w-12" />
            <h3 className="mt-4 font-semibold">No analytics data yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Complete meetings and finalize attendance to see analytics.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
