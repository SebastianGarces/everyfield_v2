// ============================================================================
// Vision Meeting Agenda — react-pdf template (F6)
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import type { DocumentMergeValues } from "../types";
import { styles } from "./styles";

const AGENDA: { title: string; detail: string }[] = [
  {
    title: "Welcome & Connection",
    detail: "Greet guests, brief introductions, set a warm tone.",
  },
  {
    title: "Our Story",
    detail: "Why this church, why now — the planter's calling.",
  },
  {
    title: "The Vision",
    detail: "Who we're reaching, what kind of church we're becoming.",
  },
  {
    title: "GROW · PRAY · GIVE",
    detail: "The invitation to join the core group and how to take part.",
  },
  {
    title: "Next Steps",
    detail: "Commitment cards, upcoming dates, and how to stay connected.",
  },
  {
    title: "Prayer & Close",
    detail: "Pray over the mission and the people in the room.",
  },
];

export function VisionMeetingAgendaDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const churchName = values.church_name || "Our Church";
  const headerParts = [
    "Vision Meeting Agenda",
    values.meeting_date || null,
  ].filter(Boolean);

  return (
    <Document title="Vision Meeting Agenda">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>{churchName}</Text>
        <Text style={styles.subtitle}>{headerParts.join("  •  ")}</Text>

        {AGENDA.map((item, i) => (
          <View key={item.title} style={{ marginBottom: 12 }}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12 }}>
              {i + 1}. {item.title}
            </Text>
            <Text style={{ color: "#6b7280", marginTop: 2 }}>
              {item.detail}
            </Text>
          </View>
        ))}

        <View style={styles.divider} />
        <Text style={{ fontSize: 9, color: "#6b7280" }}>
          {values.pastor_name
            ? `Led by ${values.pastor_name}`
            : "Keep it to 45–60 minutes. End on time and on vision."}
        </Text>
      </Page>
    </Document>
  );
}
