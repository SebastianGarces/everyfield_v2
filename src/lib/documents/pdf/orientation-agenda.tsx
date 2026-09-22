import { Document, Page, Text } from "@react-pdf/renderer";

import { orientationAgendaContent } from "../content/orientation-agenda";
import { churchNameOf } from "../render-text";
import type { DocumentMergeValues } from "../types";
import { PDF_FONT } from "./fonts";
import { styles } from "./styles";

export function OrientationAgendaDocument({
  values,
}: {
  values: DocumentMergeValues;
}) {
  const content = orientationAgendaContent(values);
  return (
    <Document title={content.title}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>{content.title}</Text>
        <Text style={styles.subtitle}>{churchNameOf(values)}</Text>
        <Text style={styles.h2} minPresenceAhead={24}>
          {content.meetingTitle}
        </Text>
        {content.details.map(({ label, value }) => (
          <Text key={label} style={styles.paragraph}>
            <Text style={{ fontFamily: PDF_FONT.bold }}>{label}: </Text>
            {value}
          </Text>
        ))}
        <Text style={styles.h2} minPresenceAhead={24}>
          Agenda
        </Text>
        {content.agendaLines.map((line, index) => (
          <Text key={index} style={styles.paragraph}>
            {line || " "}
          </Text>
        ))}
      </Page>
    </Document>
  );
}
