// ============================================================================
// Vision Meeting Agenda — react-pdf template (F6)
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import {
  VISION_MEETING_AGENDA,
  visionMeetingClosing,
} from "../content/vision-meeting-agenda";
import type { DocumentMergeValues } from "../types";
import { styles } from "./styles";

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

        {VISION_MEETING_AGENDA.map((item, i) => (
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
          {visionMeetingClosing(values.pastor_name)}
        </Text>
      </Page>
    </Document>
  );
}
