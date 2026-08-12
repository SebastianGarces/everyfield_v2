// ============================================================================
// Guest Sign-in Sheet — react-pdf template (F6)
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import { churchNameOf, documentSubtitle } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { styles } from "./styles";

const ROW_COUNT = 14;

const COLUMNS: { label: string; flex: number }[] = [
  { label: "Name", flex: 2.2 },
  { label: "Email", flex: 2.6 },
  { label: "Phone", flex: 1.6 },
  { label: "Invited By", flex: 1.8 },
];

export function SignInSheetDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const churchName = churchNameOf(values);
  const subtitle = documentSubtitle(
    "Guest Sign-in Sheet",
    values.meeting_number ? `Vision Meeting #${values.meeting_number}` : null,
    values.meeting_date || null
  );

  return (
    <Document title="Guest Sign-in Sheet">
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>{churchName}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.tableHeader}>
          {COLUMNS.map((col) => (
            <Text key={col.label} style={[styles.th, { flex: col.flex }]}>
              {col.label}
            </Text>
          ))}
        </View>

        {Array.from({ length: ROW_COUNT }).map((_, i) => (
          <View key={i} style={styles.tableRow}>
            {COLUMNS.map((col) => (
              <View key={col.label} style={[styles.td, { flex: col.flex }]} />
            ))}
          </View>
        ))}

        <Text style={{ marginTop: 16, fontSize: 9, color: "#6b7280" }}>
          Thank you for joining us. We&apos;d love to stay in touch.
        </Text>
      </Page>
    </Document>
  );
}
