import { and, or, sql, type SQL } from "drizzle-orm";

/** Shared by Quick Add, import and the pair directory. SQL equality is literal:
 * names/addresses containing % or _ must not become search patterns. */
export function duplicatePredicates(
  left: { email: SQL; firstName: SQL; lastName: SQL; phone: SQL },
  right: { email: SQL; firstName: SQL; lastName: SQL; phone: SQL }
) {
  const normalized = (value: SQL) => sql`nullif(lower(trim(${value})), '')`;
  const digits = (value: SQL) =>
    sql`regexp_replace(coalesce(${value}, ''), '[^0-9]', '', 'g')`;
  const email = sql`${normalized(left.email)} = ${normalized(right.email)}`;
  const name = and(
    sql`${normalized(left.firstName)} = ${normalized(right.firstName)}`,
    sql`${normalized(left.lastName)} = ${normalized(right.lastName)}`
  )!;
  const phone = sql`length(${digits(left.phone)}) >= 4
    and length(${digits(right.phone)}) >= 4
    and right(${digits(left.phone)}, 4) = right(${digits(right.phone)}, 4)`;
  return { email, name, phone, any: or(email, name, phone)! };
}
