// ============================================================================
// Commitment Card — react-pdf template (F6)
// ============================================================================

import { Document, Page, Text, View } from "@react-pdf/renderer";

import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { PDF_FONT } from "./fonts";
import { PAGE_SIZE, styles } from "./styles";

export function CommitmentCardDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const churchName = churchNameOf(values);

  return (
    <Document title="Core Group Commitment Card">
      <Page size={PAGE_SIZE.card} style={styles.cardPage}>
        <Text style={styles.centerHeading}>CORE GROUP COMMITMENT</Text>
        <Text style={styles.centerChurch}>{churchName}</Text>

        <Text style={styles.paragraph}>
          I commit to being a founding member of {churchName} and pledge to:
        </Text>

        <View style={styles.checkRow}>
          <View style={styles.checkbox} />
          <Text>
            <Text style={{ fontFamily: PDF_FONT.bold }}>GROW</Text> — Actively
            invite others to Vision Meetings.
          </Text>
        </View>
        <View style={styles.checkRow}>
          <View style={styles.checkbox} />
          <Text>
            <Text style={{ fontFamily: PDF_FONT.bold }}>PRAY</Text> — Faithfully
            pray for the church plant.
          </Text>
        </View>
        <View style={styles.checkRow}>
          <View style={styles.checkbox} />
          <Text>
            <Text style={{ fontFamily: PDF_FONT.bold }}>GIVE</Text> — Generously
            and sacrificially give.
          </Text>
        </View>

        <Text style={[styles.paragraph, { marginTop: 8 }]}>
          I understand this commitment covers the period from __________ until
          Launch Sunday.
        </Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            marginTop: 14,
          }}
        >
          <Text>Signed:</Text>
          <View style={styles.signatureLine} />
          <Text>Date: ____________</Text>
        </View>

        {values.pastor_name ? (
          <Text style={{ marginTop: 12, color: "#6b7280" }}>
            {values.pastor_name}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}
