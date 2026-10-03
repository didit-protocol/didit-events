import { MARIA_SELFIE_EXPIRED, STATUS } from "./fixtures";
import type { GuestAccount, GuestEventStatus } from "./types";
export const STATUS_PREVIEWS: Record<string, { status: GuestEventStatus; account?: GuestAccount }> = {
  "R-10": { status: STATUS.approved! },
  "R-19": { status: STATUS.going! },
  "R-20": { status: STATUS.inReview! },
  "R-21": { status: STATUS.declinedRetry! },
  "R-22": { status: STATUS.declinedFinal! },
  "R-23": { status: STATUS.waitlisted! },
  "R-24": { status: STATUS.notApproved! },
  "R-25": { status: STATUS.linkExpired! },
  "R-27": { status: STATUS.cancelled! },
  "R-30": { status: STATUS.checkedIn! },
  "R-31": { status: STATUS.ended! },
  "R-32": { status: STATUS.emailMismatch! },
  "R-34": { status: STATUS.linkOtherAccount! },
  "U-17": { status: STATUS.pendingNew! },
  "U-18": { status: STATUS.pendingReturning! },
  "U-29": { status: STATUS.cancelledNow! },
  "U-41": { status: STATUS.goingReused! },
  "U-42": { status: STATUS.selfieExpired!, account: MARIA_SELFIE_EXPIRED },
};

