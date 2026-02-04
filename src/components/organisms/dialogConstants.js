/**
 * Dialog Constants
 * Static data used by the History Dialog component
 */

// Duration options in minutes (10, 20, 30, ... 240)
export const durationOptions = Array.from({ length: 24 }, (_, i) => (i + 1) * 10);

// Available history types
export const typeOptions = [
    "Meeting",
    "To-Do",
    "Appointment",
    "Boardroom",
    "Call Billing",
    "Email Billing",
    "Initial Consultation",
    "Call",
    "Mail",
    "Meeting Billing",
    "Personal Activity",
    "Room 1",
    "Room 2",
    "Room 3",
    "To Do Billing",
    "Vacation",
    "Other",
];

// Maps history type to its default result
export const resultMapping = {
    Meeting: "Meeting Held",
    "To-Do": "To-do Done",
    Appointment: "Appointment Completed",
    Boardroom: "Boardroom - Completed",
    "Call Billing": "Call Billing - Completed",
    "Email Billing": "Mail - Completed",
    "Initial Consultation": "Initial Consultation - Completed",
    Call: "Call Completed",
    Mail: "Mail Sent",
    "Meeting Billing": "Meeting Billing - Completed",
    "Personal Activity": "Personal Activity - Completed",
    "Room 1": "Room 1 - Completed",
    "Room 2": "Room 2 - Completed",
    "Room 3": "Room 3 - Completed",
    "To Do Billing": "To Do Billing - Completed",
    Vacation: "Vacation - Completed",
    Other: "Attachment",
};

// Reverse mapping: result -> type
export const typeMapping = Object.fromEntries(
    Object.entries(resultMapping).map(([type, result]) => [result, type])
);
