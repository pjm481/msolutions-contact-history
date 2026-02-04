import * as React from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import DownloadIcon from "@mui/icons-material/Download";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import { useZohoInit } from "./hook/useZohoInit";
import { Table } from "./components/organisms/Table";
import { Dialog } from "./components/organisms/Dialog";
import { conn_name, dataCenterMap } from "./config/config";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { setCurrentGlobalContact } from "./GlobalState";
import { DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import { Dialog as MUIDialog } from "@mui/material";
import { useSnackbar } from "notistack";
import LinkifyText from "./components/atoms/LinkifyText";

dayjs.extend(utc);
dayjs.extend(timezone);

const ZOHO = window.ZOHO;

// ============================================================================
// STEP 3: Date Formatting Utility
// ============================================================================
// Date formatter for Zoho API (handles timezone offsets correctly)
// Formats dates in ISO 8601 format with timezone offset for Zoho API
// Output example: 2020-12-09T17:25:24-07:00 (uses the current PC/browser timezone offset)
// If hours/minutes/seconds are NOT provided, it uses the Date object's local time.
const formatDateForZoho = (date, hours, minutes, seconds) => {
  if (!date || isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, "0");

  const h = hours ?? date.getHours();
  const m = minutes ?? date.getMinutes();
  const s = seconds ?? date.getSeconds();

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const formattedTime = `${pad(h)}:${pad(m)}:${pad(s)}`;

  // Handles Timezone Offset correctly (e.g., +05:30)
  const timezoneOffset = -date.getTimezoneOffset();
  const offsetSign = timezoneOffset >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(timezoneOffset) / 60));
  const offsetMinutes = pad(Math.abs(timezoneOffset) % 60);

  return `${year}-${month}-${day}T${formattedTime}${offsetSign}${offsetHours}:${offsetMinutes}`;
};

const parentContainerStyle = {
  borderTop: "1px solid #BABABA",
  minHeight: "calc(100vh - 1px)",
  p: "1em",
};

function isInLastNDays(date, pre) {
  const now = dayjs();
  const daysAgo = now.subtract(pre, "day");
  return dayjs(date).isAfter(daysAgo);
}

const dateOptions = [
  { label: "Default", preDay: null },
  { label: "Last 7 Days", preDay: 7 },
  { label: "Last 30 Days", preDay: 30 },
  { label: "Last 90 Days", preDay: 90 },
  { label: "Current Week", custom: () => dayjs().startOf("week").format() },
  { label: "Current Month", custom: () => dayjs().startOf("month").format() },
  {
    label: "Next Week",
    custom: () => dayjs().add(1, "week").startOf("week").format(),
  },
  { label: "Custom Range", customRange: true },
];

// ============================================================================
// STEP 1: Global Cache System
// ============================================================================
// Map-based global cache that persists across filter changes and component re-renders
// Key: record ID (junction ID), Value: record data
const globalHistoryCache = new Map();

// Helper function to merge new records into the global cache
// Records are merged (not replaced) when new data is fetched
const mergeRecordsIntoCache = (newRecords) => {
  if (!Array.isArray(newRecords)) return;

  newRecords.forEach((record) => {
    if (record?.id) {
      // Use junction ID as key (or history_id as fallback)
      const cacheKey = record.id || record.history_id;
      if (cacheKey) {
        globalHistoryCache.set(cacheKey, record);
      }
    }
  });
};

// Helper function to get all records from cache as array
const getAllRecordsFromCache = () => {
  return Array.from(globalHistoryCache.values());
};

// Helper function to clear cache (useful for reset or when contact changes)
// Cache is cleared when contact changes to avoid mixing data from different contacts
const clearHistoryCache = () => {
  globalHistoryCache.clear();
};

// ============================================================================
// STEP 2: Component State Management
// ============================================================================
const App = () => {
  const { module, recordId } = useZohoInit();
  const { enqueueSnackbar } = useSnackbar();
  const [initPageContent, setInitPageContent] = React.useState(
    <CircularProgress />
  );
  // relatedListData now reads from cache, but we keep state for reactivity
  const [relatedListData, setRelatedListData] = React.useState([]);
  const [cacheVersion, setCacheVersion] = React.useState(0); // Force re-render when cache updates
  
  // Filter states
  const [, setSelectedRecordId] = React.useState(null);
  const [openEditDialog, setOpenEditDialog] = React.useState(false);
  const [openCreateDialog, setOpenCreateDialog] = React.useState(false);
  const [ownerList, setOwnerList] = React.useState([]);
  const [selectedOwner, setSelectedOwner] = React.useState(null); // Keep for backward compatibility
  const [filterOwner, setFilterOwner] = React.useState([]); // Multi-select owner filter
  const [typeList, setTypeList] = React.useState([]);
  const [selectedType, setSelectedType] = React.useState(null); // Keep for backward compatibility
  const [filterType, setFilterType] = React.useState([]); // Multi-select type filter
  const [dateRange, setDateRange] = React.useState(dateOptions[0]); // Default
  const [keyword, setKeyword] = React.useState("");
  const [loggedInUser, setLoggedInUser] = React.useState(null);
  const [selectedRowData, setSelectedRowData] = React.useState(null);
  const [currentContact, setCurrentContact] = React.useState(null);
  const [regarding, setRegarding] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [selectedContacts, setSelectedContacts] = React.useState([]);

  const [isCustomRangeDialogOpen, setIsCustomRangeDialogOpen] =
    React.useState(false);
  const [isCustomRangeApplying, setIsCustomRangeApplying] = React.useState(false);
  const [showDebugPanel, setShowDebugPanel] = React.useState(true);
  const [debugInfo, setDebugInfo] = React.useState({
    lastDefaultFetch: null,
    lastCustomFetch: null,
    updatedAt: null,
  });
  const [customRange, setCustomRange] = React.useState({
    startDate: null,
    endDate: null,
  });

  const stringifyForUi = React.useCallback((value, maxLen = 15000) => {
    let text = "";
    try {
      text = JSON.stringify(value, null, 2);
    } catch (e) {
      text = String(value);
    }
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}\n... (truncated ${text.length - maxLen} chars)`;
  }, []);

  const handleClickOpenCreateDialog = () => {
    setOpenCreateDialog(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  const handleClickOpenEditDialog = (rowData) => {
    console.log({ rowData });

    setSelectedRowData(rowData); // Set the selected row data
    // setRegarding(rowData?.regarding || ""); // Initialize regarding data
    // setDetails(rowData?.details || ""); // Initialize details data
    setOpenEditDialog(true); // Open the dialog
  };

  const handleCloseEditDialog = (updatedRowData) => {
    if (updatedRowData) {
      setRelatedListData((prevData) =>
        prevData.map((item) =>
          item.id === updatedRowData.id
            ? {
              ...item,
              ...updatedRowData,
              name: updatedRowData.Participants
                ? updatedRowData.Participants.map((c) => c.Full_Name).join(
                  ", "
                )
                : item.name,
            }
            : item
        )
      );
      setHighlightedRecordId(updatedRowData.id); // Set the highlighted record ID
    }
    setSelectedRowData(null); // Clear selectedRowData
    setOpenEditDialog(false); // Close the dialog
    // setRegarding(""); // Clear the regarding field
    // setDetails(""); // Clear the details field
  };

  // ============================================================================
  // STEP 5: Custom Date Range Fetching (Search API)
  // ============================================================================
  // Fetch History records using Search API with custom date range
  // Uses Zoho Search API with pagination and junction record filtering
  const fetchHistoryFromZoho = async (beginDate, closeDate, contactId) => {
    const debug = {
      kind: "customRange",
      startedAt: new Date().toISOString(),
      module,
      recordId: contactId,
      beginDate: beginDate?.toISOString?.() || String(beginDate),
      closeDate: closeDate?.toISOString?.() || String(closeDate),
      formattedBegin: null,
      formattedClose: null,
      criteriaUsed: null,
      searchRequests: [],
      searchPages: [],
      junctionRequests: [],
      counts: {},
      finishedAt: null,
      totalMs: null,
    };

    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Format the dates using the helper
    const formattedBegin = formatDateForZoho(beginDate, 0, 0, 0);
    const formattedClose = formatDateForZoho(closeDate, 23, 59, 59);
    debug.formattedBegin = formattedBegin;
    debug.formattedClose = formattedClose;

    if (!formattedBegin || !formattedClose) {
      throw new Error("Invalid date range provided");
    }

    let allHistoryRecords = [];
    let currentPage = 1;
    let hasMoreRecords = true;
    const recordsPerPage = 100;

    // --- STEP 1: Fetch History Records by Date ---
    // Try Date field first, fallback to Created_Time
    let searchCriteria = `((Date:greater_equal:${encodeURIComponent(formattedBegin)})and(Date:less_equal:${encodeURIComponent(formattedClose)}))`;
    debug.criteriaUsed = searchCriteria;

    while (hasMoreRecords && currentPage < 11) {
      const req_data = {
        url: `${dataCenterMap.AU}/crm/v3/History1/search?criteria=${searchCriteria}&per_page=${recordsPerPage}&page=${currentPage}`,
        method: "GET",
        param_type: 1,
      };
      debug.searchRequests.push({ page: currentPage, url: req_data.url });

      try {
        const data = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);
        let pageResults = [];
        let moreRecords = false;

        if (data?.details?.statusMessage?.data) {
          pageResults = data.details.statusMessage.data;
          moreRecords = data.details.statusMessage.info?.more_records || false;
        } else if (data?.data) {
          pageResults = Array.isArray(data.data) ? data.data : [];
          moreRecords = data.info?.more_records || false;
        }

        allHistoryRecords = [...allHistoryRecords, ...pageResults];
        hasMoreRecords = moreRecords;
        debug.searchPages.push({
          page: currentPage,
          results: pageResults.length,
          more_records: !!moreRecords,
        });
        currentPage++;
      } catch (error) {
        if (currentPage === 1 && error.message?.includes("Date")) {
          console.warn("Date field not found, trying Created_Time field");
          searchCriteria = `((Created_Time:greater_equal:${encodeURIComponent(formattedBegin)})and(Created_Time:less_equal:${encodeURIComponent(formattedClose)}))`;
          debug.criteriaUsed = searchCriteria;
          currentPage = 1;
          continue;
        }
        console.error("Pagination error:", error);
        hasMoreRecords = false;
      }
    }
    debug.counts.historySearchTotal = allHistoryRecords.length;

    // --- STEP 2: Fetch ALL Linked Junction Records (The Fix) ---
    if (contactId && allHistoryRecords.length > 0) {
      let allJunctionRecords = [];
      let jPage = 1;
      let jHasMore = true;

      // Loop to get ALL pages of related records, not just the first 200
      while (jHasMore) {
        try {
          debug.junctionRequests.push({
            page: jPage,
            Entity: "Contacts",
            RecordID: contactId,
            RelatedList: "History3",
            per_page: 200,
          });
          const junctionResponse = await ZOHO.CRM.API.getRelatedRecords({
            Entity: "Contacts",
            RecordID: contactId,
            RelatedList: "History3", // Verify this API name is correct
            page: jPage,
            per_page: 200,
          });

          const pageData = junctionResponse?.data || [];
          allJunctionRecords = [...allJunctionRecords, ...pageData];
          debug.counts.junctionTotal = allJunctionRecords.length;

          // Check if there are more records
          if (pageData.length < 200 || !junctionResponse?.info?.more_records) {
            jHasMore = false;
          } else {
            jPage++;
          }
        } catch (err) {
          console.error("Error fetching related list page " + jPage, err);
          jHasMore = false;
        }
      }

      // Create a Set of valid History IDs linked to this contact
      const contactHistoryIds = new Set(
        allJunctionRecords.map(j => j.Contact_History_Info?.id).filter(Boolean)
      );

      // Filter fetched history to only those linked to this contact
      allHistoryRecords = allHistoryRecords.filter(h => contactHistoryIds.has(h.id));
      debug.counts.historyAfterJunctionFilter = allHistoryRecords.length;

      const historyMap = new Map(allHistoryRecords.map(h => [h.id, h]));

      // Map the final data structure
      const mapped = allJunctionRecords
        .filter(j => historyMap.has(j.Contact_History_Info?.id))
        .map(junction => {
          const history = historyMap.get(junction.Contact_History_Info.id);
          const historyDate = history.Date || history.Created_Time || "No Date";

          return {
            id: junction.id,
            "Contact_Details.Full_Name": junction.Contact_Details?.name || "No Name",
            "Contact_History_Info.id": history.id,
            "Contact_History_Info.Date": historyDate,
            "Contact_History_Info.History_Type": history.History_Type || "Unknown Type",
            "Contact_History_Info.History_Result": history.History_Result || "No Result",
            "Contact_History_Info.Duration": history.Duration || "N/A",
            "Contact_History_Info.Regarding": history.Regarding || "No Regarding",
            "Contact_History_Info.History_Details_Plain": history.History_Details_Plain || history.History_Details || "No Details",
            "Contact_History_Info.Stakeholder": history.Stakeholder || null,
            "Owner.first_name": history.Owner?.first_name || "",
            "Owner.last_name": history.Owner?.last_name || "",
            History_Type: history.History_Type,
          };
        });
      debug.counts.mappedCount = mapped.length;
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.finishedAt = new Date().toISOString();
      debug.totalMs = Math.round((t1 - t0) * 100) / 100;
      setDebugInfo((prev) => ({
        ...prev,
        lastCustomFetch: debug,
        updatedAt: new Date().toISOString(),
      }));
      return mapped;
    }

    {
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.finishedAt = new Date().toISOString();
      debug.totalMs = Math.round((t1 - t0) * 100) / 100;
      setDebugInfo((prev) => ({
        ...prev,
        lastCustomFetch: debug,
        updatedAt: new Date().toISOString(),
      }));
    }
    return [];
  };

  // ============================================================================
  // STEP 4: Default Data Fetching (COQL)
  // ============================================================================
  // Default fetch uses COQL to get related list records from History_X_Contacts
  const fetchRLData = async (options = {}) => {
    if (!module || !recordId) return;
    const debug = {
      kind: "default",
      startedAt: new Date().toISOString(),
      module,
      recordId,
      stepsMs: {},
      coql: null,
      users: null,
      currentUser: null,
      contact: null,
      counts: {},
      finishedAt: null,
      totalMs: null,
    };
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      // const { data } = await zohoApi.record.getRecordsFromRelatedList({
      //   module,
      //   recordId,
      //   RelatedListAPI: "History3",
      // });

      var config = {
        "select_query": `select Name,id,Contact_History_Info.id,Owner.first_name,Owner.last_name,Contact_Details.Full_Name,Contact_History_Info.History_Type,Contact_History_Info.History_Result,Contact_History_Info.Duration,Contact_History_Info.Regarding,Contact_History_Info.History_Details_Plain,Contact_History_Info.Date,Contact_History_Info.Stakeholder  from History_X_Contacts where Contact_Details = '${recordId}' limit 200`
      }
      debug.coql = { select_query: config.select_query };
      const tCoql0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const { data } = await ZOHO.CRM.API.coql(config);
      const tCoql1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.stepsMs.coql = Math.round((tCoql1 - tCoql0) * 100) / 100;

      const dataArray = Array.isArray(data) ? data : [];
      debug.counts.coqlRows = dataArray.length;
      debug.coql.sample = dataArray[0] || null;


      console.log("dataArray 2026", dataArray);


      const tUsers0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const usersResponse = await ZOHO.CRM.API.getAllUsers({
        Type: "AllUsers",
      });
      const tUsers1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.stepsMs.getAllUsers = Math.round((tUsers1 - tUsers0) * 100) / 100;


      const validUsers = usersResponse?.users?.filter(
        (user) => user?.full_name && user?.id
      );
      setOwnerList(validUsers || []);
      debug.users = {
        total: usersResponse?.users?.length ?? null,
        valid: validUsers?.length ?? null,
        sample: validUsers?.[0] || null,
      };

      const tMe0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const currentUserResponse = await ZOHO.CRM.CONFIG.getCurrentUser();
      const tMe1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.stepsMs.getCurrentUser = Math.round((tMe1 - tMe0) * 100) / 100;
      const currentUser = currentUserResponse?.users?.[0] || null;
      setLoggedInUser(currentUser);
      debug.currentUser = currentUser
        ? { id: currentUser.id, full_name: currentUser.full_name }
        : null;

      // Initialize filterOwner with logged-in user by default
      if (currentUser?.full_name) {
        setFilterOwner([currentUser]);
        setSelectedOwner(currentUser);
      }

      const tContact0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const currentContactResponse = await ZOHO.CRM.API.getRecord({
        Entity: "Contacts",
        approved: "both",
        RecordID: recordId,
      });
      const tContact1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.stepsMs.getContact = Math.round((tContact1 - tContact0) * 100) / 100;

      console.log("currentContactData", currentContactResponse);
      setCurrentContact(currentContactResponse?.data?.[0] || null);
      debug.contact = {
        RecordID: recordId,
        found: !!currentContactResponse?.data?.[0],
        sample: currentContactResponse?.data?.[0] || null,
      };

      if (currentContact) {
        setCurrentGlobalContact(currentContact);
      }


      const tempData = dataArray?.map((obj) => {
        const ownerFirst = obj["Owner.first_name"] || "";
        const ownerLast = obj["Owner.last_name"] || "";

        const ownerName = `${ownerFirst} ${ownerLast}`.trim() || "Unknown Owner";

        return {
          name: obj["Contact_Details.Full_Name"] || "No Name",
          id: obj?.id,
          date_time: obj["Contact_History_Info.Date"] || "No Date",
          type: obj["Contact_History_Info.History_Type"] || "Unknown Type",
          result: obj["Contact_History_Info.History_Result"] || "No Result",
          duration: obj["Contact_History_Info.Duration"] || "N/A",
          regarding: obj["Contact_History_Info.Regarding"] || "No Regarding",
          details: obj["Contact_History_Info.History_Details_Plain"] || "No Details",
          icon: <DownloadIcon />,
          ownerName: ownerName,
          historyDetails: {
            id: obj["Contact_History_Info.id"],
            text: obj["Contact_History_Info.History_Details_Plain"] || "No Details",
          },
          stakeHolder: (() => {
            const flatId = obj["Contact_History_Info.Stakeholder.id"];
            const flatName = obj["Contact_History_Info.Stakeholder.Account_Name"];
            const nested = obj["Contact_History_Info.Stakeholder"];
            const junction = obj?.Stakeholder;

            const id = flatId ?? (nested && typeof nested === "object" ? nested.id : undefined) ?? (junction && typeof junction === "object" ? junction.id : undefined);
            const rawName = flatName ?? (nested && typeof nested === "object" ? (nested.Account_Name ?? nested.name) : undefined) ?? (junction && typeof junction === "object" ? (junction.Account_Name ?? junction.name) : undefined);

            return id != null ? { id, name: rawName || "" } : null;
          })(),
          history_id: obj["Contact_History_Info.id"]
        };
      });

      // Merge new records into global cache instead of replacing
      mergeRecordsIntoCache(tempData || []);

      // Update state from cache to trigger re-render
      const allCachedRecords = getAllRecordsFromCache();
      setRelatedListData(allCachedRecords);
      setCacheVersion(prev => prev + 1); // Force re-render
      debug.counts.cacheSize = allCachedRecords.length;

      const types = dataArray
        ?.map((el) => el.History_Type)
        ?.filter((el) => el !== undefined && el !== null);

      const sortedTypes = [...new Set(types)].sort((a, b) =>
        a.localeCompare(b)
      ); // Sort alphabetically

      const additionalTypes = [
        "Meeting",
        "To-Do",
        "Call",
        "Appointment",
        "Boardroom",
        "Call Billing",
        "Email Billing",
        "Initial Consultation",
        "Mail",
        "Meeting Billing",
        "Personal Activity",
        "Room 1",
        "Room 2",
        "Room 3",
        "Todo Billing",
        "Vacation",
      ]; // Example additional options

      const sortedTypesWithAdditional = [
        ...new Set([...additionalTypes, ...sortedTypes]), // Merge additional options with existing ones
      ].sort((a, b) => a.localeCompare(b)); // Sort alphabetically

      setTypeList(sortedTypesWithAdditional);

      setInitPageContent(null);
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.finishedAt = new Date().toISOString();
      debug.totalMs = Math.round((t1 - t0) * 100) / 100;
      setDebugInfo((prev) => ({
        ...prev,
        lastDefaultFetch: debug,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      console.error("Error fetching data:", error);
      if (options.isBackground) {
        enqueueSnackbar("Failed to refresh data", { variant: "error" });
      } else {
        setInitPageContent("Error loading data.");
      }
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      debug.finishedAt = new Date().toISOString();
      debug.totalMs = Math.round((t1 - t0) * 100) / 100;
      debug.error = { message: error?.message || String(error) };
      setDebugInfo((prev) => ({
        ...prev,
        lastDefaultFetch: debug,
        updatedAt: new Date().toISOString(),
      }));
    }
  };

  // ============================================================================
  // Initialization Effect: Fetch data when contact changes
  // ============================================================================
  React.useEffect(() => {
    if (module && recordId) {
      // Clear cache when contact changes to avoid mixing data from different contacts
      clearHistoryCache();
      setCacheVersion(0);
      setRelatedListData([]); // Clear UI state
      fetchRLData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRLData is stable, avoid refetch loop
  }, [module, recordId]);

  // ============================================================================
  // Cache Synchronization Effect: Sync state with cache when cacheVersion changes
  // ============================================================================
  React.useEffect(() => {
    const allCachedRecords = getAllRecordsFromCache();
    setRelatedListData(allCachedRecords);
  }, [cacheVersion]);

  const [highlightedRecordId, setHighlightedRecordId] = React.useState(null);

  // ============================================================================
  // STEP 8: Record Updates and Additions
  // ============================================================================
  const handleRecordAdded = (newRecord) => {
    // Normalize the new record to match the existing structure
    let participantsArray = [];
    if (newRecord.Participants && newRecord.Participants.length > 0) {
      participantsArray = newRecord.Participants.map((participant) => ({
        id: participant.id || "N/A",
        Full_Name: participant.Full_Name || "Unknown",
        Email: participant.Email || "No Email",
        Mobile: participant.Mobile || "N/A",
        First_Name: participant.First_Name || "Unknown",
        Last_Name: participant.Last_Name || "Unknown",
        ID_Number: participant.ID_Number || "N/A",
      }));
    }

    const normalizedRecord = {
      id: newRecord.id,
      name: newRecord.Participants
        ? newRecord.Participants.map((c) => c.Full_Name).join(", ")
        : newRecord.name || "Unknown Name",
      date_time: newRecord.Date || dayjs().format(), // Ensure date is consistent
      type: newRecord.History_Type || "Unknown Type",
      result: newRecord.History_Result || "No Result",
      duration: newRecord.Duration || "N/A",
      regarding: newRecord.Regarding || "No Regarding",
      details: newRecord.History_Details_Plain || "No Details",
      ownerName: newRecord.Owner?.full_name || "Unknown Owner",
      historyDetails: {
        ...newRecord.historyDetails,
        name: newRecord.Participants
          ? newRecord.Participants.map((c) => c.Full_Name).join(", ")
          : newRecord.historyDetails?.name || "Unknown",
      },
      stakeHolder: newRecord.Stakeholder || null,
      Participants: participantsArray,
    };

    // Merge new record into global cache
    mergeRecordsIntoCache([normalizedRecord]);

    // Update state from cache to trigger re-render
    const allCachedRecords = getAllRecordsFromCache();
    setRelatedListData(allCachedRecords);
    setCacheVersion(prev => prev + 1);

    // Highlight the newly added record
    setHighlightedRecordId(newRecord.id);

    setRegarding(normalizedRecord.regarding || "No Regarding");
    setDetails(normalizedRecord.details || "No Details");
    setSelectedContacts(newRecord.Participants);
    // Debug logs
    console.log("New Record Normalized:", normalizedRecord);
    fetchRLData({ isBackground: true });
  };

  const handleRightSideDataShow = (currentRegarding, currentDetails) => {
    setRegarding(currentRegarding || "No Regarding");
    setDetails(currentDetails || "No Details");
  };

  // Update existing record in cache
  const handleRecordUpdate = (updatedRecord) => {
    console.log("Updated before by maddie:", updatedRecord);

    // Normalize updatedRecord keys to match relatedListData keys
    const normalizedRecord = {
      ...updatedRecord,
      type: updatedRecord.History_Type,
      result: updatedRecord.History_Result,
      duration: updatedRecord.Duration,
      regarding: updatedRecord.Regarding,
      details: updatedRecord.History_Details_Plain,
      ownerName: updatedRecord?.Owner?.full_name,
      date_time: updatedRecord?.Date, // Ensure date is consistent
      stakeHolder: updatedRecord?.Stakeholder,
      // name: updatedRecord.Participants
      //     ? updatedRecord.Participants.map((c) => c.Full_Name).join(", ")
      //     : updatedRecord.name,
    };

    console.log("Updated after by maddie:", updatedRecord);

    // Update record in global cache
    if (normalizedRecord.id) {
      const existingRecord = globalHistoryCache.get(normalizedRecord.id);
      const updatedRecordData = {
        ...existingRecord,
        ...normalizedRecord,
        name: updatedRecord.Participants
          ? updatedRecord.Participants.map((c) => c.Full_Name).join(", ")
          : existingRecord?.name || normalizedRecord.name,
      };
      globalHistoryCache.set(normalizedRecord.id, updatedRecordData);
    }

    // Update state from cache to trigger re-render
    const allCachedRecords = getAllRecordsFromCache();
    setRelatedListData(allCachedRecords);
    setCacheVersion(prev => prev + 1);

    setRegarding(updatedRecord.Regarding || "No Regarding");
    setDetails(updatedRecord.History_Details_Plain || "No Details");
    setHighlightedRecordId(updatedRecord.id); // Highlight the updated record
    fetchRLData({ isBackground: true });
  };

  // ============================================================================
  // STEP 7: Reactive Filtering Logic
  // ============================================================================
  // Filtering happens client-side using useMemo that reads from the global cache
  // Always filter from the global cache to ensure we have all data
  const filteredData = React.useMemo(() => {
    // Get all records from cache (includes all previously fetched data)
    const allRecords = getAllRecordsFromCache();

    if (!allRecords || allRecords.length === 0) {
      return [];
    }

    return allRecords.filter((el) => {
      // 1. Owner Filter (multi-select)
      const ownerMatch = filterOwner.length === 0 ||
        filterOwner.some((owner) => {
          const ownerName = (owner?.full_name || owner || "").trim().toLowerCase();
          const recordOwner = (el?.ownerName || "").trim().toLowerCase();
          // Support exact and flexible matching
          return ownerName === recordOwner ||
            recordOwner.includes(ownerName) ||
            ownerName.includes(recordOwner);
        });

      // 2. Type Filter (multi-select)
      const typeMatch = filterType.length === 0 || filterType.includes(el?.type);

      // 3. Date Filter
      let dateMatch = true;
      if (dateRange?.preDay) {
        const isValidDate = dayjs(el?.date_time).isValid();
        dateMatch = isValidDate && isInLastNDays(el?.date_time, dateRange?.preDay);
      } else if (dateRange?.startDate && dateRange?.endDate) {
        // Normalize dates to start/end of day for accurate comparison
        const startDate = dayjs(dateRange.startDate).startOf("day");
        const endDate = dayjs(dateRange.endDate).endOf("day");
        const recordDate = dayjs(el?.date_time);

        // Use inclusive boundaries: records on startDate and endDate should be included
        dateMatch = (
          (recordDate.isSame(startDate, "day") || recordDate.isAfter(startDate)) &&
          (recordDate.isSame(endDate, "day") || recordDate.isBefore(endDate))
        );
      } else if (dateRange?.custom) {
        const startDate = dayjs(dateRange.custom());
        const endDate = dayjs();
        dateMatch = dayjs(el?.date_time).isBetween(startDate, endDate, null, "[]");
      }

      // 4. Keyword Filter
      const keywordMatch = !keyword.trim() || (() => {
        const lowerCaseKeyword = keyword.trim().toLowerCase();
        return (
          el.name?.toLowerCase().includes(lowerCaseKeyword) ||
          el.details?.toLowerCase().includes(lowerCaseKeyword) ||
          el.regarding?.toLowerCase().includes(lowerCaseKeyword)
        );
      })();

      // Combine all filters with AND logic
      return ownerMatch && typeMatch && dateMatch && keywordMatch;
    });
  }, [cacheVersion, filterOwner, filterType, dateRange, keyword]); // Use cacheVersion to react to cache updates

  // ============================================================================
  // STEP 11: Active Filter Summary
  // ============================================================================
  // Get active filter names for summary display
  const activeFilterNames = React.useMemo(() => {
    const activeFilters = [];

    // Date filter (check if it's not the default option)
    const isDefaultDate = dateRange?.label === "Default" ||
      (dateRange?.preDay === null && !dateRange?.startDate && !dateRange?.custom);
    if (dateRange && !isDefaultDate) {
      activeFilters.push("Date");
    }

    // Type filter
    if (filterType.length > 0) {
      activeFilters.push("Type");
    }

    // Owner filter (only if subset is selected)
    if (filterOwner.length > 0 && filterOwner.length < ownerList.length) {
      activeFilters.push("Owner");
    }

    // Keyword filter
    if (keyword.trim()) {
      activeFilters.push("Keyword");
    }

    return activeFilters;
  }, [dateRange, filterType, filterOwner, ownerList.length, keyword]);

  // ============================================================================
  // STEP 9: Clear Filters Function
  // ============================================================================
  // Note: This clears filters but keeps the cache intact
  // Cache remains intact - filteredData will show all cached records when filters are cleared
  const handleClearFilters = React.useCallback(() => {
    setFilterType([]);
    // Reset owner filter to logged-in user only (default state)
    if (loggedInUser?.full_name) {
      setFilterOwner([loggedInUser]);
      setSelectedOwner(loggedInUser);
    } else {
      setFilterOwner([]);
      setSelectedOwner(null);
    }
    setDateRange(dateOptions[0]); // Reset to Default
    setKeyword("");
    setCustomRange({ startDate: null, endDate: null });
    // Also reset backward-compatible single selects
    setSelectedType(null);
    // Cache remains intact - filteredData will show all cached records when filters are cleared
  }, [loggedInUser]);

  const [applications, setApplications] = React.useState([]);
  const [openApplicationDialog, setOpenApplicationDialog] =
    React.useState(false);

  const handleMoveToApplication = async () => {
    try {
      // Fetch related applications for the current contact
      const response = await ZOHO.CRM.API.getRelatedRecords({
        Entity: "Contacts",
        RecordID: currentContact?.id,
        RelatedList: "Applications",
        page: 1,
        per_page: 200,
      });
      if (response?.data) {
        setApplications(response.data || []);
        setOpenApplicationDialog(true); // Open the application selection dialog
      } else {
        throw new Error("No related applications found.");
      }
    } catch (error) {
      console.error("Error fetching related applications:", error);
      // setSnackbar({
      //   open: true,
      //   message: "Failed to fetch related applications.",
      //   severity: "error",
      // });
    }
  };

  return (
    <React.Fragment>
      <Box sx={parentContainerStyle}>
        {initPageContent ? (
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            {initPageContent}
          </span>
        ) : (relatedListData?.length > 0 || getAllRecordsFromCache().length > 0) ? (
          <Grid container spacing={2}>
            <Grid
              item
              xs={9}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                "& > *": { flexGrow: 1, flexBasis: "0px" },
              }}
            >
              <Autocomplete
                size="small"
                options={dateOptions}
                value={dateRange}
                getOptionLabel={(option) => {
                  // Handle custom range object with startDate/endDate
                  if (option?.startDate && option?.endDate) {
                    return `${dayjs(option.startDate).format("DD/MM/YYYY")} - ${dayjs(option.endDate).format("DD/MM/YYYY")}`;
                  }
                  // Handle regular dateOptions
                  return option?.label || "";
                }}
                isOptionEqualToValue={(option, value) => {
                  // Compare custom range objects
                  if (option?.startDate && value?.startDate) {
                    return (
                      dayjs(option.startDate).isSame(dayjs(value.startDate), "day") &&
                      dayjs(option.endDate).isSame(dayjs(value.endDate), "day")
                    );
                  }
                  // Compare regular options
                  return option?.label === value?.label;
                }}
                sx={{
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt",
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt",
                  },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Dates"
                    size="small"
                    InputLabelProps={{ style: { fontSize: "9pt" } }}
                  />
                )}
                componentsProps={{
                  popper: {
                    sx: {
                      "& .MuiAutocomplete-listbox": {
                        fontSize: "9pt",
                      },
                    },
                  },
                }}
                onChange={(e, value) => {
                  if (value?.customRange) {
                    setIsCustomRangeDialogOpen(true); // Open custom range dialog
                  } else {
                    setDateRange(value); // Set normal date range
                  }
                }}
              />

              <Autocomplete
                size="small"
                multiple
                options={typeList}
                value={filterType}
                onChange={(e, newValue) => {
                  setFilterType(newValue);
                  // Update backward-compatible single select
                  setSelectedType(newValue.length === 1 ? newValue[0] : null);
                }}
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt", // Adjust font size for selected value
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Types"
                    size="small"
                    InputLabelProps={{ style: { fontSize: "9pt" } }}
                  />
                )}
                componentsProps={{
                  popper: {
                    sx: {
                      "& .MuiAutocomplete-listbox": {
                        fontSize: "9pt", // Font size for dropdown options
                      },
                    },
                  },
                }}
                renderTags={(value, getTagProps) =>
                  value.length > 0 ? (
                    <span style={{ fontSize: "9pt" }}>
                      {value.length} selected
                    </span>
                  ) : null
                }
              />

              <TextField
                size="small"
                label="Keyword"
                variant="outlined"
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt", // Font size for input text
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                InputProps={{
                  style: {
                    fontSize: "9pt", // Additional inline styling for input text
                  },
                }}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Autocomplete
                size="small"
                multiple
                options={ownerList || []}
                getOptionLabel={(option) => option?.full_name || "Unknown User"}
                value={filterOwner}
                onChange={(e, newValue) => {
                  setFilterOwner(newValue);
                  // Update backward-compatible single select
                  setSelectedOwner(newValue.length === 1 ? newValue[0] : null);
                }}
                isOptionEqualToValue={(option, value) =>
                  option?.id === value?.id
                }
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Users" size="small" />
                )}
                componentsProps={{
                  popper: {
                    sx: {
                      "& .MuiAutocomplete-listbox": {
                        fontSize: "9pt", // Font size for dropdown options
                      },
                    },
                  },
                }}
                renderTags={(value, getTagProps) =>
                  value.length > 0 ? (
                    <span style={{ fontSize: "9pt" }}>
                      {value.length} selected
                    </span>
                  ) : null
                }
              />
            </Grid>
            <Grid
              item
              xs={3}
              sx={{ display: "flex", justifyContent: "flex-end" }}
            >
              <Button
                variant="contained"
                sx={{
                  flexGrow: 1,
                  padding: "4px 8px",
                  fontSize: "0.75rem",
                  minHeight: "33px",
                  maxHeight: "33px",
                  lineHeight: "1rem",
                }}
                onClick={handleClickOpenCreateDialog}
              >
                Create
              </Button>
            </Grid>
            {/* Filter Summary and Clear Button */}
            <Grid item xs={12}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  fontSize: "9pt",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <span>
                    <strong>Total Records:</strong> {filteredData?.length || 0}
                  </span>
                  {activeFilterNames.length > 0 && (
                    <>
                      <span>•</span>
                      <span>
                        <strong>Filter By:</strong> {activeFilterNames.join(", ")}
                      </span>
                    </>
                  )}
                </Box>
                {(activeFilterNames.length > 0 || keyword.trim()) && (
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setShowDebugPanel((v) => !v)}
                      sx={{
                        fontSize: "9pt",
                        padding: "2px 8px",
                        minHeight: "24px",
                      }}
                    >
                      {showDebugPanel ? "Hide Debug" : "Show Debug"}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleClearFilters}
                      sx={{
                        fontSize: "9pt",
                        padding: "2px 8px",
                        minHeight: "24px",
                      }}
                    >
                      Clear Filters
                    </Button>
                  </Box>
                )}
              </Box>
            </Grid>
            <Grid item xs={9}>
              <Table
                rows={filteredData}
                setSelectedRecordId={setSelectedRecordId}
                handleClickOpenEditDialog={handleClickOpenEditDialog}
                handleRightSideDataShow={handleRightSideDataShow}
                highlightedRecordId={highlightedRecordId} // Pass highlighted ID to the table
                keyword={keyword}
              />
            </Grid>
            <Grid item xs={3}>
              {/* sidebar - details component */}
              <Paper sx={{ height: "100%", position: "relative" }}>
                <Box
                  sx={{
                    position: "absolute",
                    inset: "1rem",
                    overflow: "auto",
                    wordWrap: "break-word",
                    whiteSpace: "normal",
                    lineHeight: 1
                  }}
                >
                  {!!regarding && (
                    <span
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        padding: "4px",
                        backgroundColor: "rgba(236, 240, 241, 1)",
                        borderRadius: "4px",
                        wordWrap: "break-word",
                        whiteSpace: "normal",
                        fontSize: "9pt",
                      }}
                    >
                      {regarding}
                    </span>
                  )}
                  <LinkifyText details={details} />
                </Box>
              </Paper>
            </Grid>
            {showDebugPanel && (
              <Grid item xs={12}>
                <Paper sx={{ p: 1.5, mt: 1, fontSize: "9pt" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                    <Box>
                      <strong>Debug</strong>{" "}
                      <span style={{ color: "#666" }}>
                        (updated: {debugInfo.updatedAt || "—"})
                      </span>
                    </Box>
                    <Box sx={{ color: "#666" }}>
                      cache: {getAllRecordsFromCache().length} • relatedListData: {relatedListData.length} • filtered: {filteredData.length}
                    </Box>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Active filters</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi({
  dateRange,
  filterOwner: filterOwner.map((o) => ({ id: o?.id, full_name: o?.full_name })),
  filterType,
  keyword,
})}
                    </pre>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Last default fetch (COQL)</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi(debugInfo.lastDefaultFetch)}
                    </pre>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Last custom fetch (Search API)</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi(debugInfo.lastCustomFetch)}
                    </pre>
                  </Box>
                </Paper>
              </Grid>
            )}
          </Grid>
        ) : (
          <Grid container spacing={2}>
            <Grid
              item
              xs={9}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                "& > *": { flexGrow: 1, flexBasis: "0px" },
              }}
            >
              <Autocomplete
                size="small"
                options={dateOptions}
                value={dateRange}
                // 1. Ensure it renders the custom label correctly
                getOptionLabel={(option) => {
                  // If it's our custom object with a label property, use it
                  if (option?.label) return option.label;
                  return "Unknown";
                }}
                // 2. Help React understand when the custom object matches the selected value
                isOptionEqualToValue={(option, value) => {
                  // If exact object match
                  if (option === value) return true;
                  // If both are custom ranges with same dates
                  if (option?.startDate && value?.startDate) {
                    return (
                      dayjs(option.startDate).isSame(dayjs(value.startDate), 'day') &&
                      dayjs(option.endDate).isSame(dayjs(value.endDate), 'day')
                    );
                  }
                  // Standard label match
                  return option?.label === value?.label;
                }}
                sx={{
                  "& .MuiInputBase-root": { height: "33px", fontSize: "9pt" },
                  "& .MuiInputLabel-root": { fontSize: "9pt" },
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Dates"
                    size="small"
                    InputLabelProps={{ style: { fontSize: "9pt" } }}
                  />
                )}
              // ... existing onChange logic ...
              />
              <Autocomplete
                size="small"
                options={typeList}
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt", // Adjust font size for selected value
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Types" size="small" />
                )}
                onChange={(e, value) => setSelectedType(value)}
              />
              <TextField
                size="small"
                label="Keyword"
                variant="outlined"
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt", // Font size for input text
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Autocomplete
                size="small"
                options={ownerList || []}
                getOptionLabel={(option) => option?.full_name || "Unknown User"}
                value={selectedOwner || null}
                isOptionEqualToValue={(option, value) =>
                  option?.id === value?.id
                }
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt", // Adjust label font size
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Users" size="small" />
                )}
                onChange={(e, value) => setSelectedOwner(value)}
              />
            </Grid>
            <Grid
              item
              xs={3}
              sx={{
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button
                variant="contained"
                sx={{
                  flexGrow: 1,
                  padding: "4px 8px",
                  fontSize: "0.75rem",
                  minHeight: "33px",
                  maxHeight: "33px",
                  lineHeight: "1rem",
                }}
                onClick={handleClickOpenCreateDialog}
              >
                Create
              </Button>
            </Grid>
            <Box mt={2}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Result</TableCell>
                      <TableCell>Date & Time</TableCell>
                      <TableCell>Owner</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {relatedListData.length > 0 ? (
                      relatedListData.map((row) => (
                        <TableRow
                          key={row.id}
                          sx={{
                            backgroundColor:
                              row.id === highlightedRecordId
                                ? "rgba(0, 123, 255, 0.1)"
                                : "inherit", // Highlight if ID matches
                          }}
                        >
                          <TableCell>{row.name || "Unknown Name"}</TableCell>
                          <TableCell>{row.type || "Unknown Type"}</TableCell>
                          <TableCell>{row.result || "No Result"}</TableCell>
                          <TableCell>
                            {row.date_time
                              ? dayjs(row.date_time).format(
                                "DD/MM/YYYY HH:mm A"
                              )
                              : "No Date"}
                          </TableCell>
                          <TableCell>
                            {row.ownerName || "Unknown Owner"}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          No data available
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
            {showDebugPanel && (
              <Box mt={1} width="100%">
                <Paper sx={{ p: 1.5, fontSize: "9pt" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                    <Box>
                      <strong>Debug</strong>{" "}
                      <span style={{ color: "#666" }}>
                        (updated: {debugInfo.updatedAt || "—"})
                      </span>
                    </Box>
                    <Box sx={{ color: "#666" }}>
                      cache: {getAllRecordsFromCache().length} • relatedListData: {relatedListData.length} • filtered: {filteredData.length}
                    </Box>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Active filters</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi({
  dateRange,
  filterOwner: filterOwner.map((o) => ({ id: o?.id, full_name: o?.full_name })),
  filterType,
  keyword,
})}
                    </pre>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Last default fetch (COQL)</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi(debugInfo.lastDefaultFetch)}
                    </pre>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <strong>Last custom fetch (Search API)</strong>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
{stringifyForUi(debugInfo.lastCustomFetch)}
                    </pre>
                  </Box>
                </Paper>
              </Box>
            )}
          </Grid>
        )}
      </Box>
      <Dialog
        openDialog={openEditDialog}
        handleCloseDialog={handleCloseEditDialog}
        title="Edit History"
        ownerList={ownerList}
        loggedInUser={loggedInUser}
        ZOHO={ZOHO}
        selectedRowData={selectedRowData}
        onRecordAdded={handleRecordUpdate} // Update the existing record
        selectedContacts={selectedContacts}
        setSelectedContacts={setSelectedContacts}
        buttonText="Update"
        handleMoveToApplication={handleMoveToApplication}
        applications={applications}
        openApplicationDialog={openApplicationDialog}
        setOpenApplicationDialog={setOpenApplicationDialog}
      />
      <Dialog
        openDialog={openCreateDialog}
        handleCloseDialog={handleCloseCreateDialog}
        title="Create"
        ownerList={ownerList}
        loggedInUser={loggedInUser}
        ZOHO={ZOHO}
        onRecordAdded={handleRecordAdded} // Pass the callback
        currentContact={currentContact}
        selectedContacts={selectedContacts}
        setSelectedContacts={setSelectedContacts}
        buttonText="Save"
      />
      {isCustomRangeDialogOpen && (
        <MUIDialog
          open={isCustomRangeDialogOpen}
          onClose={() => setIsCustomRangeDialogOpen(false)}
          fullWidth
          maxWidth="xs"
          sx={{
            "& .MuiDialogContent-root": {
              padding: "8px", // Reduce padding for compactness
            },
          }}
        >
          <DialogTitle sx={{ fontSize: "14px", padding: "8px" }}>
            Select Custom Date Range
          </DialogTitle>
          <DialogContent>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <Box display="flex" flexDirection="column" gap={1.5}>
                <DatePicker
                  label="Start Date"
                  value={customRange.startDate}
                  format="DD/MM/YYYY"
                  onChange={(newValue) =>
                    setCustomRange((prev) => ({ ...prev, startDate: newValue }))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      variant="outlined"
                      sx={{
                        width: "8rem", // Match other fields
                        "& .MuiInputBase-root": {
                          height: "20px", // Match small field height
                          fontSize: "9pt",
                        },
                        "& .MuiInputLabel-root": {
                          fontSize: "9pt", // Match label size
                        },
                      }}
                    />
                  )}
                  slotProps={{
                    popper: { placement: "right-start" },
                    textField: { size: "small" },
                  }}
                />
                <DatePicker
                  label="End Date"
                  value={customRange.endDate}
                  format="DD/MM/YYYY"
                  onChange={(newValue) =>
                    setCustomRange((prev) => ({ ...prev, endDate: newValue }))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      variant="outlined"
                      sx={{
                        width: "8rem", // Match other fields
                        "& .MuiInputBase-root": {
                          height: "20px", // Match small field height
                          fontSize: "12px",
                        },
                        "& .MuiInputLabel-root": {
                          fontSize: "9pt", // Match label size
                        },
                      }}
                    />
                  )}
                  slotProps={{
                    popper: { placement: "right-start" },
                    textField: { size: "small" },
                  }}
                />
              </Box>
            </LocalizationProvider>
          </DialogContent>
          <DialogActions sx={{ padding: "8px" }}>
            <Button
              onClick={() => setIsCustomRangeDialogOpen(false)}
              color="secondary"
              size="small"
              disabled={isCustomRangeApplying}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                // ============================================================================
                // STEP 6: Custom Date Range Handler
                // ============================================================================
                if (isCustomRangeApplying) return;
                setIsCustomRangeApplying(true);

                // Validate dates are selected
                if (!customRange.startDate || !customRange.endDate) {
                  enqueueSnackbar("Please select both start and end dates.", {
                    variant: "warning",
                  });
                  setIsCustomRangeApplying(false);
                  return;
                }

                // Validate end date is after start date
                if (dayjs(customRange.endDate).isBefore(dayjs(customRange.startDate), "day")) {
                  enqueueSnackbar("End date must be after start date.", {
                    variant: "warning",
                  });
                  setIsCustomRangeApplying(false);
                  return;
                }

                try {
                  // Normalize the dayjs objects from the picker into Date objects
                  // DatePicker returns dayjs objects, convert to Date with proper time
                  const startDayjs = dayjs(customRange.startDate);
                  const endDayjs = dayjs(customRange.endDate);

                  // Create Date objects at start and end of day
                  const beginDate = startDayjs.startOf("day").toDate();
                  const closeDate = endDayjs.endOf("day").toDate();

                  // Fetch data using Search API pattern
                  setInitPageContent(<CircularProgress />);
                  const searchResults = await fetchHistoryFromZoho(beginDate, closeDate, recordId);

                  // Process the results using the same mapping logic as fetchRLData
                  if (searchResults && searchResults.length > 0) {
                    // Debug: inspect what we got back from Zoho
                    console.log("[Custom Range] Raw searchResults:", {
                      count: searchResults.length,
                      first: searchResults[0],
                      all: searchResults,
                    });

                    const tempData = searchResults.map((obj) => {
                      const ownerFirst = obj["Owner.first_name"] || "";
                      const ownerLast = obj["Owner.last_name"] || "";
                      const ownerName = `${ownerFirst} ${ownerLast}`.trim() || "Unknown Owner";

                      return {
                        name: obj["Contact_Details.Full_Name"] || "No Name",
                        id: obj?.id,
                        date_time: obj["Contact_History_Info.Date"] || "No Date",
                        type: obj["Contact_History_Info.History_Type"] || "Unknown Type",
                        result: obj["Contact_History_Info.History_Result"] || "No Result",
                        duration: obj["Contact_History_Info.Duration"] || "N/A",
                        regarding: obj["Contact_History_Info.Regarding"] || "No Regarding",
                        details: obj["Contact_History_Info.History_Details_Plain"] || "No Details",
                        icon: <DownloadIcon />,
                        ownerName: ownerName,
                        historyDetails: {
                          id: obj["Contact_History_Info.id"],
                          text: obj["Contact_History_Info.History_Details_Plain"] || "No Details",
                        },
                        stakeHolder: (() => {
                          const stakeholder = obj["Contact_History_Info.Stakeholder"];
                          if (stakeholder && typeof stakeholder === "object" && stakeholder.id) {
                            return {
                              id: stakeholder.id,
                              name: stakeholder.Account_Name || stakeholder.name || "",
                            };
                          }
                          return null;
                        })(),
                        history_id: obj["Contact_History_Info.id"]
                      };
                    });

                    // Debug: inspect mapped records used by the UI/table
                    console.log("[Custom Range] Mapped tempData (table rows):", {
                      count: tempData.length,
                      first: tempData[0],
                      all: tempData,
                    });

                    // Merge new records into global cache instead of replacing
                    mergeRecordsIntoCache(tempData || []);

                    // Update state from cache to trigger re-render
                    const allCachedRecords = getAllRecordsFromCache();
                    console.log("[Custom Range] Cache after merge:", {
                      count: allCachedRecords.length,
                      first: allCachedRecords[0],
                    });
                    setRelatedListData(allCachedRecords);
                    setCacheVersion(prev => prev + 1);
                    setInitPageContent(null);

                    // WHEN SETTING STATE:
                    const formattedStart = dayjs(customRange.startDate).format("DD/MM/YYYY");
                    const formattedEnd = dayjs(customRange.endDate).format("DD/MM/YYYY");

                    // Construct the object exactly how the Autocomplete expects it
                    const newCustomRangeObject = {
                      startDate: customRange.startDate,
                      endDate: customRange.endDate,
                      label: `${formattedStart} - ${formattedEnd}`, // This prevents [object Object]
                      custom: true // Helper flag for your filter logic
                    };

                    setDateRange(newCustomRangeObject);

                    enqueueSnackbar(`Found ${tempData.length} records for the selected date range.`, {
                      variant: "success",
                    });
                  } else {
                    // No new records found, but keep existing cache
                    setInitPageContent(null);
                    enqueueSnackbar("No new records found for the selected date range.", {
                      variant: "info",
                    });

                    // Still set the dateRange for display
                    const formattedStart = dayjs(customRange.startDate).format("DD/MM/YYYY");
                    const formattedEnd = dayjs(customRange.endDate).format("DD/MM/YYYY");

                    setDateRange({
                      startDate: customRange.startDate,
                      endDate: customRange.endDate,
                      label: `${formattedStart} - ${formattedEnd}`,
                    });
                  }

                  setIsCustomRangeDialogOpen(false);
                } catch (error) {
                  console.error("Error fetching custom date range:", error);
                  setInitPageContent("Error loading data.");
                  enqueueSnackbar("Failed to fetch records for the selected date range.", {
                    variant: "error",
                  });
                } finally {
                  setIsCustomRangeApplying(false);
                }
              }}
              color="primary"
              size="small"
              disabled={isCustomRangeApplying}
            >
              {isCustomRangeApplying ? (
                <>
                  <CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />
                  Apply
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </DialogActions>
        </MUIDialog>
      )}
    </React.Fragment>
  );
};

export default App;
