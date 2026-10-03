"use client";

import dynamic from "next/dynamic";

/** AP-27 opens from event settings on demand (`?requirements=1`), so its code stays out of the settings first load. */
export const LazyRequirementsModal = dynamic(() => import("./RequirementsModal").then((m) => m.RequirementsModal));
