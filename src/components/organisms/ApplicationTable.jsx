import React, { useState } from "react";
import dayjs from "dayjs";
import { APPLICATIONS_HISTORY_STAKEHOLDER_FIELD } from "../../config/config";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Radio,
  Button,
  Dialog as MUIDialog,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
  CircularProgress,
  Box,
} from "@mui/material";


const ApplicationTable = ({
  applications,
  selectedApplicationId,
  setSelectedApplicationId,
  currentContact,
}) => {
  const handleRowSelect = (id) => {
    setSelectedApplicationId(id);
  };

  return (
    <TableContainer>
      <Table sx={{ fontSize: "9pt" }}>
        <TableHead>
          <TableRow></TableRow>
          <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
            {" "}
            {/* Custom header color */}
            <TableCell />
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Application No
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Type of Application
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              File Status
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              File Progress
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Visa Grant Date
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(Array.isArray(applications) ? applications : []).map((app) => (
            <TableRow key={app.id}>
              <TableCell>
                <Radio
                  checked={selectedApplicationId === app.id}
                  onChange={() => handleRowSelect(app.id)}
                  sx={{ padding: "4px" }} // Reduce padding
                />
              </TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>{app.Name}</TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>
                {app.Type_of_Application}
              </TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>{app.File_Status}</TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>
                {app.File_Progress || "-"}
              </TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>
                {app.Visa_Grant_Date || "N/A"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const ApplicationDialog = ({
  openApplicationDialog,
  handleApplicationDialogClose,
  applications,
  ZOHO,
  handleDelete,
  formData,
  historyContacts,
  selectedRowData,
  currentContact,
  selectedOwner,
}) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  const handleCloseSnackbar = () => {
    setSnackbar({ open: false, message: "", severity: "success" });
  };

  const handleApplicationSelect = async () => {
    if (!selectedApplicationId) {
      setSnackbar({
        open: true,
        message: "Please select an application.",
        severity: "warning",
      });
      return;
    }

    const contacts = Array.isArray(historyContacts) ? historyContacts : [];
    if (contacts.length === 0) {
      setSnackbar({
        open: true,
        message: "No contacts associated with this history. Please add at least one contact.",
        severity: "error",
      });
      return;
    }

    if (!selectedRowData) {
      setSnackbar({
        open: true,
        message: "History record data is missing. Please close and try again.",
        severity: "error",
      });
      return;
    }

    setIsMoving(true);
    try {
      const firstContactName = contacts[0]?.Full_Name || contacts[0]?.full_name || "Unknown";
      // Use formData first (current form values), then selectedRowData (original row)
      const stakeHolder = formData?.stakeHolder ?? selectedRowData?.stakeHolder;
      const stakeholderId =
        stakeHolder && typeof stakeHolder === "object"
          ? stakeHolder.id ?? stakeHolder.Id ?? stakeHolder.ID
          : null;
      const stakeholderForApi =
        stakeholderId != null
          ? { id: String(stakeholderId) }
          : null;

      const apiData = {
        Name: firstContactName,
        Application: { id: selectedApplicationId },
        History_Details: formData?.details ?? selectedRowData?.details ?? "",
        History_Result: formData?.result ?? selectedRowData?.result ?? "",
        History_Type: formData?.type ?? selectedRowData?.type ?? "",
        Regarding: formData?.regarding ?? selectedRowData?.regarding ?? "",
        Duration_Min: formData?.duration ?? selectedRowData?.duration ?? null,
        Date: (() => {
          const dt = formData?.date_time ?? selectedRowData?.date_time;
          return dt ? dayjs(dt).format("YYYY-MM-DDTHH:mm:ssZ") : null;
        })(),
        [APPLICATIONS_HISTORY_STAKEHOLDER_FIELD]: stakeholderForApi,
        Owner: selectedOwner,
      };

      const createApplicationHistory = await ZOHO.CRM.API.insertRecord({
        Entity: "Applications_History",
        APIData: apiData,
        Trigger: ["workflow"],
      });

      if (createApplicationHistory?.data[0]?.code === "SUCCESS") {
        const newHistoryId = createApplicationHistory.data[0].details.id;

        // Create junction records linking Application History to Contacts
        for (const contact of contacts) {
          const contactId = contact?.id;
          if (!contactId) continue;
          await ZOHO.CRM.API.insertRecord({
            Entity: "Application_Hstory",
            APIData: {
              Application_Hstory: { id: newHistoryId },
              Contact: { id: contactId },
            },
            Trigger: ["workflow"],
          });
        }

        var func_name = "copy_attachment_form_contact_history_to_applicatio";

        const history_id =
          selectedRowData?.historyDetails?.id || selectedRowData?.history_id;

        var req_data = {
          arguments: JSON.stringify({
            fromModule: "History1",
            toModule: "Applications_History",
            fromID: history_id,
            ToID: newHistoryId,
          }),
        };

        await ZOHO.CRM.FUNCTIONS.execute(func_name, req_data).then(function (
          data
        ) {
          console.log(data);
        });

        // Delete the current history and associated contacts
        await handleDelete();

        setSnackbar({
          open: true,
          message: "History moved successfully!",
          severity: "success",
        });
      } else {
        throw new Error("Failed to create new application history.");
      }
    } catch (error) {
      console.error("Error moving history:", error);
      setSnackbar({
        open: true,
        message: error?.message || "Failed to move history. Please try again.",
        severity: "error",
      });
    } finally {
      setIsMoving(false);
      handleApplicationDialogClose();
    }
  };

  return (
    <>
      <MUIDialog
        open={openApplicationDialog}
        onClose={handleApplicationDialogClose}
        PaperProps={{
          sx: {
            minWidth: "600px",
            maxWidth: "800px",
            padding: "16px",
            fontSize: "9pt", // Global font size for the dialog
          },
        }}
      >
        <DialogContent sx={{ position: "relative" }}>
          {isMoving && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255, 255, 255, 0.8)",
                zIndex: 1,
              }}
            >
              <CircularProgress size={48} />
            </Box>
          )}
          <ApplicationTable
            applications={applications}
            selectedApplicationId={selectedApplicationId}
            setSelectedApplicationId={setSelectedApplicationId}
            currentContact={currentContact}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleApplicationDialogClose}
            color="secondary"
            disabled={isMoving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleApplicationSelect(currentContact)}
            color="primary"
            disabled={!selectedApplicationId || isMoving}
            startIcon={isMoving ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isMoving ? "Moving..." : "Move"}
          </Button>
        </DialogActions>
      </MUIDialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ApplicationDialog;
