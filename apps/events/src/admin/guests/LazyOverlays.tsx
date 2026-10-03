"use client";

import dynamic from "next/dynamic";

/**
 * The add-guests modal (A-07) opens on demand, so its code loads on demand too: this keeps it out of the guests
 * tab's first-load JS. It still server-renders when the URL opens it. (The drawer loads through `GuestDrawerHost`.)
 */
export const LazyAddGuests = dynamic(() => import("./AddGuests").then((m) => m.AddGuests));
