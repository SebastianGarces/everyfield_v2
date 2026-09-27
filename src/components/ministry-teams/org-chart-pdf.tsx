import { Document, Font, Page, Text, View, pdf } from "@react-pdf/renderer";
import {
  PDF_FONT,
  PDF_FONT_BASE_PATH,
  registerPdfFonts,
} from "@/lib/documents/pdf/fonts";
import { LEADERSHIP_TEAM_KEY } from "@/lib/ministry-teams/role-templates";
import type { ChartTeam } from "@/lib/ministry-teams/org-chart-model";

/** Each team starts a readable page; long rosters flow onto continuation pages. */
export async function orgChartPdf(
  teams: ChartTeam[],
  allTeams: boolean
): Promise<Blob> {
  await registerPdfFonts(Font, async (file) => {
    const response = await fetch(`${PDF_FONT_BASE_PATH}/${file}`, {
      cache: "force-cache",
    });
    if (!response.ok) throw new Error("Font unavailable");
    return new Uint8Array(await response.arrayBuffer());
  });
  const root = allTeams
    ? teams.find((team) => team.templateKey === LEADERSHIP_TEAM_KEY)
    : undefined;
  return pdf(
    <Document title="Team organization chart">
      {teams.map((team) => (
        <Page
          key={team.id}
          size="A4"
          style={{
            padding: 36,
            fontFamily: PDF_FONT.body,
            fontSize: 11,
            color: "#0f172a",
          }}
        >
          <Text style={{ fontSize: 10, marginBottom: 12 }}>
            Organization chart · {allTeams ? "All Teams" : "Single Team"}
          </Text>
          {root && root.id !== team.id && (
            <Text style={{ marginBottom: 12 }}>
              {root.name} · {root.leader?.name ?? "No leader appointed"}
            </Text>
          )}
          <View
            style={{
              padding: 14,
              borderWidth: 1,
              borderColor: "#64748b",
              backgroundColor: "#eff6ff",
              marginBottom: 16,
            }}
          >
            <Text style={{ fontFamily: PDF_FONT.bold, fontSize: 18 }}>
              {team.name}
            </Text>
            <Text style={{ marginTop: 8 }}>
              Team leader: {team.leader?.name ?? "No leader appointed"}
            </Text>
          </View>
          <Text style={{ fontFamily: PDF_FONT.bold, marginBottom: 8 }}>
            Team roles
          </Text>
          {team.roles.length === 0 && <Text>No roles configured.</Text>}
          {team.roles.map((role) => (
            <View
              key={role.id}
              style={{
                marginLeft: 18,
                borderLeftWidth: 2,
                borderLeftColor: "#94a3b8",
                paddingLeft: 12,
                paddingVertical: 8,
                marginBottom: 4,
              }}
            >
              <Text style={{ fontFamily: PDF_FONT.bold }}>
                {role.person?.name ?? "Vacant"}
              </Text>
              <Text style={{ marginTop: 4 }}>
                {role.name}
                {role.leadership ? " · Leadership role" : ""}
              </Text>
            </View>
          ))}
          <Text
            fixed
            style={{ position: "absolute", bottom: 16, left: 36, fontSize: 9 }}
            render={({ pageNumber, totalPages }) =>
              `${team.name} · ${pageNumber} / ${totalPages}`
            }
          />
        </Page>
      ))}
    </Document>
  ).toBlob();
}
