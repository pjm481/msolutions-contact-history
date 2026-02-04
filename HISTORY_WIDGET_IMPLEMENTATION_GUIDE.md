# History Widget Implementation Guide

## Overview

This guide documents the **actual implementation** of the History Widget filtering and fetching pattern used in the Contact History widget. The pattern includes:

- ✅ Global cache management with Map-based storage
- ✅ Intelligent data persistence across filter changes
- ✅ Reactive client-side filtering
- ✅ Dual fetching strategies (COQL for default, Search API for custom ranges)
- ✅ Smart cache restoration

---

## Step 1: Global Cache System

**Location**: `src/App.js` (top-level, outside component)

The implementation uses a **Map-based global cache** that persists across filter changes and component re-renders:

```javascript
// Global cache to store all fetched history records
// Key: record ID (junction ID), Value: record data
// This persists across filter changes and component re-renders
const globalHistoryCache = new Map();

// Helper function to merge new records into the global cache
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
const clearHistoryCache = () => {
  globalHistoryCache.clear();
};
```

**Key Points:**
- Cache persists across filter changes
- Records are merged (not replaced) when new data is fetched
- Cache is keyed by record ID (junction ID) for deduplication
- Cache is cleared when contact changes to avoid mixing data

---

## Step 2: Component State Management

**Location**: `src/App.js` (inside App component)

The component uses React state with a cache version tracker for reactivity:

```javascript
const App = () => {
  // ... other hooks
  
  // relatedListData now reads from cache, but we keep state for reactivity
  const [relatedListData, setRelatedListData] = React.useState([]);
  const [cacheVersion, setCacheVersion] = React.useState(0); // Force re-render when cache updates
  
  // Filter states
  const [filterOwner, setFilterOwner] = React.useState([]); // Multi-select owner filter
  const [filterType, setFilterType] = React.useState([]); // Multi-select type filter
  const [dateRange, setDateRange] = React.useState(dateOptions[0]); // Default
  const [keyword, setKeyword] = React.useState("");
  
  // ... rest of component
};
```

**Cache Synchronization Effect:**

```javascript
// Sync relatedListData with cache whenever cacheVersion changes
React.useEffect(() => {
  const allCachedRecords = getAllRecordsFromCache();
  setRelatedListData(allCachedRecords);
}, [cacheVersion]);
```

**Initialization Effect:**

```javascript
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
```

---

## Step 3: Date Formatting Utility

**Location**: `src/App.js` (top-level, outside component)

```javascript
// Date formatter for Zoho API (handles timezone offsets correctly)
const formatDateForZoho = (date, hours = 0, minutes = 0, seconds = 0) => {
  if (!date || isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const formattedTime = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  // Handles Timezone Offset correctly (e.g., +05:30)
  const timezoneOffset = -date.getTimezoneOffset();
  const offsetSign = timezoneOffset >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(timezoneOffset) / 60));
  const offsetMinutes = pad(Math.abs(timezoneOffset) % 60);

  return `${year}-${month}-${day}T${formattedTime}${offsetSign}${offsetHours}:${offsetMinutes}`;
};
```

**Key Points:**
- Formats dates in ISO 8601 format with timezone offset
- Handles timezone offsets correctly for Zoho API
- Returns `null` for invalid dates

---

## Step 4: Default Data Fetching (COQL)

**Location**: `src/App.js` (inside App component)

The default fetch uses **COQL** to get related list records:

```javascript
const fetchRLData = async (options = {}) => {
  if (!module || !recordId) return;
  try {
    var config = {
      "select_query": `select Name,id,Contact_History_Info.id,Owner.first_name,Owner.last_name,Contact_Details.Full_Name,Contact_History_Info.History_Type,Contact_History_Info.History_Result,Contact_History_Info.Duration,Contact_History_Info.Regarding,Contact_History_Info.History_Details_Plain,Contact_History_Info.Date,Contact_History_Info.Stakeholder  from History_X_Contacts where Contact_Details = '${recordId}' limit 200`
    }
    const { data } = await ZOHO.CRM.API.coql(config);

    const dataArray = Array.isArray(data) ? data : [];

    // Map to UI format
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

    // ... rest of function (type list extraction, etc.)
  } catch (error) {
    console.error("Error fetching data:", error);
    // ... error handling
  }
};
```

**Key Points:**
- Uses COQL to fetch from `History_X_Contacts` junction table
- Maps data to UI format
- Merges into cache (doesn't replace)
- Updates state from cache to trigger re-render

---

## Step 5: Custom Date Range Fetching (Search API)

**Location**: `src/App.js` (inside App component)

For custom date ranges, the implementation uses **Zoho Search API** with pagination:

```javascript
// Fetch History records using Search API with custom date range
const fetchHistoryFromZoho = async (beginDate, closeDate, contactId) => {
  // Format the dates using the helper
  const formattedBegin = formatDateForZoho(beginDate, 0, 0, 0);
  const formattedClose = formatDateForZoho(closeDate, 23, 59, 59);

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

  while (hasMoreRecords && currentPage < 11) {
    const req_data = {
      url: `${dataCenterMap.AU}/crm/v3/History1/search?criteria=${searchCriteria}&per_page=${recordsPerPage}&page=${currentPage}`,
      method: "GET",
      param_type: 1,
    };

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
      currentPage++;
    } catch (error) {
      if (currentPage === 1 && error.message?.includes("Date")) {
        console.warn("Date field not found, trying Created_Time field");
        searchCriteria = `((Created_Time:greater_equal:${encodeURIComponent(formattedBegin)})and(Created_Time:less_equal:${encodeURIComponent(formattedClose)}))`;
        currentPage = 1;
        continue;
      }
      console.error("Pagination error:", error);
      hasMoreRecords = false;
    }
  }

  // --- STEP 2: Fetch ALL Linked Junction Records ---
  if (contactId && allHistoryRecords.length > 0) {
    let allJunctionRecords = [];
    let jPage = 1;
    let jHasMore = true;

    // Loop to get ALL pages of related records, not just the first 200
    while (jHasMore) {
      try {
        const junctionResponse = await ZOHO.CRM.API.getRelatedRecords({
          Entity: "Contacts",
          RecordID: contactId,
          RelatedList: "History3",
          page: jPage,
          per_page: 200,
        });

        const pageData = junctionResponse?.data || [];
        allJunctionRecords = [...allJunctionRecords, ...pageData];

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

    const historyMap = new Map(allHistoryRecords.map(h => [h.id, h]));

    // Map the final data structure
    return allJunctionRecords
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
  }

  return [];
};
```

**Key Points:**
- Uses Search API with pagination (up to 10 pages)
- Tries `Date` field first, falls back to `Created_Time` if needed
- Fetches ALL junction records (not just first page)
- Filters history records to only those linked to the contact
- Returns mapped data structure matching COQL format

---

## Step 6: Custom Date Range Handler

**Location**: `src/App.js` (inside App component, in custom range dialog)

When user applies a custom date range:

```javascript
<Button
  onClick={async () => {
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

    try {
      // Normalize the dayjs objects from the picker into Date objects
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

        // Merge new records into global cache instead of replacing
        mergeRecordsIntoCache(tempData || []);

        // Update state from cache to trigger re-render
        const allCachedRecords = getAllRecordsFromCache();
        setRelatedListData(allCachedRecords);
        setCacheVersion(prev => prev + 1);
        setInitPageContent(null);

        // Create proper dateRange object with label for display
        const formattedStart = dayjs(customRange.startDate).format("DD/MM/YYYY");
        const formattedEnd = dayjs(customRange.endDate).format("DD/MM/YYYY");

        setDateRange({
          startDate: customRange.startDate,
          endDate: customRange.endDate,
          label: `${formattedStart} - ${formattedEnd}`,
        });

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
    } catch (error) {
      console.error("Error fetching custom date range:", error);
      setInitPageContent(null);
      enqueueSnackbar("Failed to fetch records for the selected date range.", {
        variant: "error",
      });
    }
    setIsCustomRangeDialogOpen(false);
  }}
>
  APPLY
</Button>
```

**Key Points:**
- Validates dates before fetching
- Uses Search API for custom ranges
- Merges results into cache (doesn't replace)
- Updates dateRange state with formatted label
- Shows success/error messages

---

## Step 7: Reactive Filtering Logic

**Location**: `src/App.js` (inside App component)

Filtering happens client-side using `useMemo` that reads from the global cache:

```javascript
// Reactive filtering with useMemo for performance
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
```

**Key Points:**
- Always filters from global cache (not from `relatedListData` state)
- Depends on `cacheVersion` to react to cache updates
- Supports multi-select for owner and type filters
- Date filtering handles predefined ranges, custom ranges, and default
- Keyword search across name, details, and regarding fields

---

## Step 8: Record Updates and Additions

**Location**: `src/App.js` (inside App component)

When records are added or updated, they're merged into the cache:

```javascript
const handleRecordAdded = (newRecord) => {
  // Normalize the new record to match the existing structure
  // ... normalization logic ...

  // Merge new record into global cache
  mergeRecordsIntoCache([normalizedRecord]);

  // Update state from cache to trigger re-render
  const allCachedRecords = getAllRecordsFromCache();
  setRelatedListData(allCachedRecords);
  setCacheVersion(prev => prev + 1);

  // ... rest of handler
};

const handleRecordUpdate = (updatedRecord) => {
  // Normalize updatedRecord keys to match relatedListData keys
  const normalizedRecord = {
    ...updatedRecord,
    type: updatedRecord.History_Type,
    result: updatedRecord.History_Result,
    duration: updatedRecord.Duration,
    regarding: updatedRecord.Regarding,
    details: updatedRecord.History_Details_Plain,
    ownerName: updatedRecord?.Owner?.full_name,
    date_time: updatedRecord?.Date,
    stakeHolder: updatedRecord?.Stakeholder,
    name: updatedRecord.Participants
      ? updatedRecord.Participants.map((c) => c.Full_Name).join(", ")
      : updatedRecord.name,
  };

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

  // ... rest of handler
};
```

**Key Points:**
- New records are merged into cache
- Updated records replace existing cache entries
- State is updated from cache after changes
- `cacheVersion` is incremented to trigger re-render

---

## Step 9: Clear Filters Function

**Location**: `src/App.js` (inside App component)

```javascript
// Clear all filters function
// Note: This clears filters but keeps the cache intact
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
```

**Key Points:**
- Clears all filter states
- Resets owner filter to logged-in user (default)
- Resets date range to "Default"
- **Cache remains intact** - all previously fetched data is still available
- Filtering will show all cached records when filters are cleared

---

## Step 10: Date Options Configuration

**Location**: `src/App.js` (top-level, outside component)

```javascript
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
```

**Helper Function:**

```javascript
function isInLastNDays(date, pre) {
  const now = dayjs();
  const daysAgo = now.subtract(pre, "day");
  return dayjs(date).isAfter(daysAgo);
}
```

---

## Step 11: Active Filter Summary

**Location**: `src/App.js` (inside App component)

```javascript
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

  // Owner filter
  const isDefaultOwner = filterOwner.length === 1 &&
    filterOwner[0]?.id === loggedInUser?.id;
  if (filterOwner.length > 0 && !isDefaultOwner) {
    activeFilters.push("Owner");
  }

  // Keyword filter
  if (keyword.trim()) {
    activeFilters.push("Keyword");
  }

  return activeFilters;
}, [dateRange, filterType, filterOwner, keyword, loggedInUser]);
```

---

## Summary

This implementation provides:

✅ **Global Cache**: Map-based storage that persists across filter changes  
✅ **Dual Fetching**: COQL for default data, Search API for custom date ranges  
✅ **Smart Merging**: New data merges into cache (doesn't replace)  
✅ **Reactive Filtering**: Client-side filtering from cache using `useMemo`  
✅ **Cache Persistence**: Data remains available when switching filters  
✅ **Cache Versioning**: `cacheVersion` state triggers re-renders when cache updates  

**Key Architecture Decisions:**

1. **Map-based Cache**: Simple, efficient, no external dependencies
2. **Cache Version Tracking**: `cacheVersion` state ensures UI updates when cache changes
3. **Dual Fetch Strategy**: COQL for performance (default), Search API for flexibility (custom ranges)
4. **Merge Strategy**: All fetches merge into cache, ensuring data persistence
5. **Client-Side Filtering**: Fast, reactive filtering from cached data

**Data Flow:**

1. **Initial Load**: `fetchRLData()` → COQL → Map to UI format → Merge into cache → Update state
2. **Custom Range**: `fetchHistoryFromZoho()` → Search API → Junction records → Map to UI format → Merge into cache → Update state
3. **Filter Change**: Filter state changes → `filteredData` recalculates from cache → UI updates
4. **Clear Filters**: Filter states reset → `filteredData` shows all cached records → UI updates

This pattern ensures that **all fetched data persists** across filter changes, providing a smooth user experience where previously fetched data remains available even when switching between filters.
