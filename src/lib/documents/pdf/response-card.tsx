// ============================================================================
// Response Card — react-pdf template (F6)
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { PAGE_SIZE, styles } from "./styles";

const INTERESTS: string[] = [
  "I'd like to learn more about the church plant.",
  "I want to join the core group.",
  "I'd like someone to pray for me.",
  "Please add me to the email list.",
];

const FIELDS: string[] = ["Name", "Email", "Phone"];

export function ResponseCardDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const churchName = churchNameOf(values);

  return (
    <Document title="Response Card">
      <Page size={PAGE_SIZE.card} style={styles.cardPage}>
        <Text style={styles.centerHeading}>RESPONSE CARD</Text>
        <Text style={styles.centerChurch}>{churchName}</Text>

        {FIELDS.map((label) => (
          <View
            key={label}
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              marginBottom: 7,
            }}
          >
            <Text style={{ width: 42 }}>{label}:</Text>
            <View style={styles.signatureLine} />
          </View>
        ))}

        <Text style={{ marginTop: 6, marginBottom: 4 }}>
          I&apos;m interested in:
        </Text>
        {INTERESTS.map((interest) => (
          <View key={interest} style={styles.checkRow}>
            <View style={styles.checkbox} />
            <Text>{interest}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
