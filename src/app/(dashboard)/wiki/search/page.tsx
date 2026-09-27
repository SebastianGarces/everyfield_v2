import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { searchWikiPage } from "@/lib/wiki/search";
import {
  parseWikiSearchParams,
  wikiSearchHref,
} from "@/lib/wiki/search-params";
import { WikiSearchForm } from "@/components/wiki/wiki-search-form";
import { WikiSearchResults } from "@/components/wiki/wiki-search-results";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Search Wiki" };

export default async function WikiSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await getCurrentSession();
  const params = parseWikiSearchParams(await searchParams);
  let data;
  try {
    data = await searchWikiPage(params, user?.churchId ?? null);
  } catch (error) {
    console.error("Wiki results search failed:", error);
  }
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Search Wiki</h1>
        <p className="text-muted-foreground">
          Find guidance, then narrow it by phase or article type.
        </p>
      </header>
      <WikiSearchForm key={wikiSearchHref(params)} params={params} />
      {!params.q ? (
        <p className="text-muted-foreground">
          Enter a topic to search the Wiki.
        </p>
      ) : !data ? (
        <div role="alert" className="space-y-3">
          <p>Search is unavailable. Try again.</p>
          <Button asChild variant="outline">
            <a href={wikiSearchHref(params)}>Retry search</a>
          </Button>
        </div>
      ) : (
        <>
          <p role="status" className="text-muted-foreground text-sm">
            {data.total} {data.total === 1 ? "result" : "results"} found
          </p>
          {data.total === 0 ? (
            <div className="space-y-2">
              <h2 className="text-lg font-medium">No matching articles</h2>
              <p className="text-muted-foreground">
                Try a different term or broaden the filters.
              </p>
            </div>
          ) : (
            <WikiSearchResults results={data.results} />
          )}
          {data.results.length < data.total && (
            <Button asChild variant="outline">
              <Link
                scroll={false}
                href={wikiSearchHref({ ...params, page: params.page + 1 })}
              >
                Load more results
              </Link>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
