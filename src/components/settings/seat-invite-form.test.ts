import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SeatPicker } from "@/components/settings/seat-invite-form";
import { Select, SelectItem } from "@/components/ui/select";
import type { InvitableSeat } from "@/db/schema/user-invitation";
import type { SeatTenancyType } from "@/lib/auth/tenancy";
import { parseElements } from "@/lib/testing/rendered-markup";

type SeatContext = {
  tenancyType: SeatTenancyType;
  member: string;
  admin: string;
};

const SEAT_CONTEXTS: readonly SeatContext[] = [
  {
    tenancyType: "church",
    member: "Member — takes part in the work",
    admin: "Admin — can run the plant with you",
  },
  {
    tenancyType: "sending_church",
    member: "Member — reads everything, changes nothing",
    admin: "Admin — reads everything and can invite others",
  },
  {
    tenancyType: "network",
    member: "Member — reads everything, changes nothing",
    admin: "Admin — reads everything and can invite others",
  },
];

type ElementProps = {
  children?: ReactNode;
  onValueChange?: unknown;
  value?: unknown;
};

function descendants(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement(node)) return [];

  const element = node as ReactElement<ElementProps>;

  return [
    element,
    ...Children.toArray(element.props.children).flatMap((child) =>
      descendants(child)
    ),
  ];
}

function renderPicker(tenancyType: SeatTenancyType, seat: InvitableSeat) {
  return renderToStaticMarkup(
    createElement(SeatPicker, {
      tenancyType,
      seat,
      onSeatChange: () => {},
    })
  );
}

test("choosing Admin keeps the closed seat selector and submitted value in sync", () => {
  for (const context of SEAT_CONTEXTS) {
    let selectedSeat: InvitableSeat = "member";
    const picker = SeatPicker({
      tenancyType: context.tenancyType,
      seat: selectedSeat,
      onSeatChange: (seat) => {
        selectedSeat = seat;
      },
    });
    const select = descendants(picker).find(
      (element) => element.type === Select
    );

    assert.ok(select, `${context.tenancyType}: Select is missing`);
    (select.props.onValueChange as (value: string) => void)("admin");
    assert.equal(
      selectedSeat,
      "admin",
      `${context.tenancyType}: Admin selects`
    );

    const html = renderPicker(context.tenancyType, selectedSeat);
    const elements = parseElements(html);
    const trigger = elements.find((element) => element.attrs.id === "seat");
    const submittedSeat = elements.find(
      (element) =>
        element.tag === "input" &&
        element.attrs.type === "hidden" &&
        element.attrs.name === "seat"
    );

    assert.ok(trigger, `${context.tenancyType}: closed selector is missing`);
    assert.equal(trigger.attrs["aria-describedby"], "seat-description");
    assert.equal(submittedSeat?.attrs.value, "admin");
    assert.match(html, /data-slot="select-value"[^>]*>Admin<\/span>/);
    assert.match(
      html,
      new RegExp(`id="seat-description"[^>]*>${context.admin}<`)
    );
  }
});

test("each opened seat menu keeps both complete role descriptions", () => {
  for (const context of SEAT_CONTEXTS) {
    const picker = SeatPicker({
      tenancyType: context.tenancyType,
      seat: "member",
      onSeatChange: () => {},
    });
    const menuItems = descendants(picker)
      .filter((element) => element.type === SelectItem)
      .map((element) => element.props.children);

    assert.deepEqual(menuItems, [context.member, context.admin]);
  }
});
