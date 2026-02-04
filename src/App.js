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
  const [, setSelectedOwner] = React.useState(null);
  const [filterOwner, setFilterOwner] = React.useState([]); // Multi-select owner filter
  const [typeList, setTypeList] = React.useState([]);
  const [, setSelectedType] = React.useState(null);
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
  const [customRange, setCustomRange] = React.useState({
    startDate: null,
    endDate: null,
  });

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
  // COQL v8 Fetch Helper (up to 2000 records in one call)
  // ============================================================================
  /**
   * Fetch History_X_Contacts via COQL v8 API (up to 2000 records in one call)
   * Uses CONNECTION.invoke POST to {dataCenter}/crm/v8/coql
   * @param {string} contactId - Contact record ID (from widget context)
   * @param {number} [limit=2000] - Max records (v8 allows up to 2000)
   * @param {number} [offset=0] - Pagination offset
   * @returns {Promise<Array>} - Array of junction records
   */
  const fetchHistoryViaCoqlV8 = async (contactId, limit = 2000, offset = 0) => {
    const selectQuery = `select Name,id,Contact_History_Info.id,Owner.first_name,Owner.last_name,Contact_Details.Full_Name,Contact_History_Info.History_Type,Contact_History_Info.History_Result,Contact_History_Info.Duration,Contact_History_Info.Regarding,Contact_History_Info.History_Details_Plain,Contact_History_Info.Date,Contact_History_Info.Stakeholder from History_X_Contacts where Contact_Details = '${contactId}' LIMIT ${offset}, ${limit}`;

    const req_data = {
      url: `${dataCenterMap.AU}/crm/v8/coql`,
      method: "POST",
      param_type: 2, // Send parameters in request body (payload)
      parameters: { select_query: selectQuery },
    };

    const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);

    // Handle response format (may vary: data vs details.statusMessage.data)
    let data = [];
    if (response?.data) {
      data = Array.isArray(response.data) ? response.data : [];
    } else if (response?.details?.statusMessage?.data) {
      data = Array.isArray(response.details.statusMessage.data)
        ? response.details.statusMessage.data
        : [];
    }

    return data;
  };

  // ============================================================================
  // STEP 4: Default Data Fetching (COQL v8 – up to 2000 records per plan)
  // ============================================================================
  const fetchRLData = async (options = {}) => {
    if (!module || !recordId) return;
    // Migration Solutions History = Contact History; COQL v8 fetches History_X_Contacts for Contact only
    const isContactsModule = /^Contacts/i.test(module);
    if (!isContactsModule) {
      setInitPageContent("This widget is designed for Contact records. Please open a Contact record.");
      return;
    }
    try {
      let dataArray = [];
      try {
        dataArray = await fetchHistoryViaCoqlV8(recordId, 2000, 0);
      } catch (coqlError) {
        console.warn("COQL v8 (2000) failed, falling back to 200:", coqlError);
        dataArray = await fetchHistoryViaCoqlV8(recordId, 200, 0);
      }
      dataArray = Array.isArray(dataArray) ? dataArray : [];

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

            const id =
              flatId ??
              (nested && typeof nested === "object" ? (nested.id ?? nested.Id ?? nested.ID) : undefined) ??
              (junction && typeof junction === "object" ? (junction.id ?? junction.Id ?? junction.ID) : undefined);
            const rawName =
              flatName ??
              (nested && typeof nested === "object" ? (nested.Account_Name ?? nested.name ?? nested.AccountName) : undefined) ??
              (junction && typeof junction === "object" ? (junction.Account_Name ?? junction.name ?? junction.AccountName) : undefined);

            return id != null ? { id, name: rawName || "" } : null;
          })(),
          history_id: obj["Contact_History_Info.id"]
        };
      });

      const usersResponse = await ZOHO.CRM.API.getAllUsers({
        Type: "AllUsers",
      });

      const validUsers = usersResponse?.users?.filter(
        (user) => user?.full_name && user?.id
      );
      setOwnerList(validUsers || []);

      const currentUserResponse = await ZOHO.CRM.CONFIG.getCurrentUser();
      const currentUser = currentUserResponse?.users?.[0] || null;
      setLoggedInUser(currentUser);

      const currentContactResponse = await ZOHO.CRM.API.getRecord({
        Entity: "Contacts",
        approved: "both",
        RecordID: recordId,
      });

      const contactData = currentContactResponse?.data?.[0] || null;
      setCurrentContact(contactData);
      if (contactData) {
        setCurrentGlobalContact(contactData);
      }

      // Merge new records into global cache instead of replacing
      mergeRecordsIntoCache(tempData || []);

      // Update state from cache to trigger re-render
      const allCachedRecords = getAllRecordsFromCache();
      setRelatedListData(allCachedRecords);
      setCacheVersion(prev => prev + 1); // Force re-render

      const types = dataArray
        ?.map((el) => el["Contact_History_Info.History_Type"])
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
    } catch (error) {
      console.error("Error fetching data:", error);
      if (options.isBackground) {
        enqueueSnackbar("Failed to refresh data", { variant: "error" });
      } else {
        setInitPageContent("Error loading data.");
      }
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

    const records = Array.isArray(allRecords) ? allRecords : [];
    if (records.length === 0) {
      return [];
    }

    return records.filter((el) => {
      // 1. Owner Filter (multi-select)
      const owners = Array.isArray(filterOwner) ? filterOwner : [];
      const types = Array.isArray(filterType) ? filterType : [];
      const ownerMatch = owners.length === 0 ||
        owners.some((owner) => {
          const ownerName = (owner?.full_name || owner || "").trim().toLowerCase();
          const recordOwner = (el?.ownerName || "").trim().toLowerCase();
          // Support exact and flexible matching
          return ownerName === recordOwner ||
            recordOwner.includes(ownerName) ||
            ownerName.includes(recordOwner);
        });

      // 2. Type Filter (multi-select)
      const typeMatch = types.length === 0 || types.includes(el?.type);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheVersion forces re-compute when global cache is updated
  }, [cacheVersion, filterOwner, filterType, dateRange, keyword]);

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
    // Reset owner filter to show all users (no default filter)
    setFilterOwner([]);
    setSelectedOwner(null);
    setDateRange(dateOptions[0]); // Reset to Default
    setKeyword("");
    setCustomRange({ startDate: null, endDate: null });
    // Also reset backward-compatible single selects
    setSelectedType(null);
    // Cache remains intact - filteredData will show all cached records when filters are cleared
  }, []);

  const [applications, setApplications] = React.useState([]);
  const [openApplicationDialog, setOpenApplicationDialog] =
    React.useState(false);

  const handleMoveToApplication = async () => {
    if (!currentContact?.id) {
      enqueueSnackbar("Contact information is not available. Please refresh the page and try again.", {
        variant: "error",
      });
      return;
    }
    try {
      const response = await ZOHO.CRM.API.getRelatedRecords({
        Entity: "Contacts",
        RecordID: currentContact.id,
        RelatedList: "Applications",
        page: 1,
        per_page: 200,
      });
      if (response?.data && response.data.length > 0) {
        setApplications(response.data);
        setOpenApplicationDialog(true);
      } else {
        enqueueSnackbar("No related applications found for this contact.", {
          variant: "info",
        });
      }
    } catch (error) {
      console.error("Error fetching related applications:", error);
      enqueueSnackbar(
        error?.message || "Failed to fetch applications. Please try again.",
        { variant: "error" }
      );
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
                options={dateOptions || []}
                value={dateRange ?? dateOptions?.[0]}
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
                options={typeList || []}
                value={filterType ?? []}
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
                value={filterOwner ?? []}
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
                options={dateOptions || []}
                value={dateRange ?? dateOptions?.[0]}
                getOptionLabel={(option) => {
                  if (option?.startDate && option?.endDate) {
                    return `${dayjs(option.startDate).format("DD/MM/YYYY")} - ${dayjs(option.endDate).format("DD/MM/YYYY")}`;
                  }
                  return option?.label || "";
                }}
                isOptionEqualToValue={(option, value) => {
                  if (option?.startDate && value?.startDate) {
                    return (
                      dayjs(option.startDate).isSame(dayjs(value.startDate), "day") &&
                      dayjs(option.endDate).isSame(dayjs(value.endDate), "day")
                    );
                  }
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
                onChange={(e, value) => {
                  if (value?.customRange) {
                    setIsCustomRangeDialogOpen(true);
                  } else {
                    setDateRange(value);
                  }
                }}
              />
              <Autocomplete
                size="small"
                multiple
                options={typeList || []}
                value={filterType ?? []}
                getOptionLabel={(option) => (option && String(option)) || ""}
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                    fontSize: "9pt",
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt",
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Types" size="small" />
                )}
                renderTags={(value) =>
                  value.length > 0 ? (
                    <span style={{ fontSize: "9pt" }}>{value.length} selected</span>
                  ) : null
                }
                onChange={(e, newValue) => {
                  setFilterType(newValue);
                  setSelectedType(newValue.length === 1 ? newValue[0] : null);
                }}
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
                multiple
                options={ownerList || []}
                getOptionLabel={(option) => option?.full_name || "Unknown User"}
                value={filterOwner ?? []}
                isOptionEqualToValue={(option, value) =>
                  option?.id === value?.id
                }
                sx={{
                  width: "8rem",
                  "& .MuiInputBase-root": {
                    height: "33px",
                  },
                  "& .MuiInputLabel-root": {
                    fontSize: "9pt",
                  },
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Users" size="small" />
                )}
                renderTags={(value) =>
                  value.length > 0 ? (
                    <span style={{ fontSize: "9pt" }}>{value.length} selected</span>
                  ) : null
                }
                onChange={(e, newValue) => {
                  setFilterOwner(newValue);
                  setSelectedOwner(newValue.length === 1 ? newValue[0] : null);
                }}
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
                    {(Array.isArray(relatedListData) ? relatedListData : []).length > 0 ? (
                      (Array.isArray(relatedListData) ? relatedListData : []).map((row) => (
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
        currentContact={currentContact}
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
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // ============================================================================
                // STEP 6: Custom Date Range Handler (client-side filtering only)
                // ============================================================================
                // Validate dates are selected
                if (!customRange.startDate || !customRange.endDate) {
                  enqueueSnackbar("Please select both start and end dates.", {
                    variant: "warning",
                  });
                  return;
                }

                // Validate end date is after start date
                if (dayjs(customRange.endDate).isBefore(dayjs(customRange.startDate), "day")) {
                  enqueueSnackbar("End date must be after start date.", {
                    variant: "warning",
                  });
                  return;
                }

                // Client-side filtering only - no API call
                // We already have up to 2000 records in cache from initial COQL v8 fetch
                const formattedStart = dayjs(customRange.startDate).format("DD/MM/YYYY");
                const formattedEnd = dayjs(customRange.endDate).format("DD/MM/YYYY");

                const newCustomRangeObject = {
                  startDate: customRange.startDate,
                  endDate: customRange.endDate,
                  label: `${formattedStart} - ${formattedEnd}`,
                };

                setDateRange(newCustomRangeObject);
                setIsCustomRangeDialogOpen(false);

                // Snackbar will show filtered count after next render (filteredData updates)
                enqueueSnackbar("Date range filter applied (client-side).", {
                  variant: "success",
                });
              }}
              color="primary"
              size="small"
            >
              Apply
            </Button>
          </DialogActions>
        </MUIDialog>
      )}
    </React.Fragment>
  );
};

export default App;
