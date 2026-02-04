/**
 * History API Service
 * Handles all Zoho CRM API operations for History records
 */
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import { zohoApi } from "../../zohoApi";

dayjs.extend(timezone);

const ZOHO = window.ZOHO;

/**
 * Log API response to Zoho Log_Module for debugging
 */
export const logResponse = async ({
    name,
    payload,
    response,
    result,
    trigger,
    meetingType,
    Widget_Source,
}) => {
    try {
        const timeOccurred = dayjs()
            .tz("Australia/Adelaide")
            .format("YYYY-MM-DDTHH:mm:ssZ");

        const logInsertResponse = await ZOHO.CRM.API.insertRecord({
            Entity: "Log_Module",
            APIData: {
                Name: name,
                Payload: JSON.stringify(payload),
                Response: JSON.stringify(response),
                Result: result,
                Trigger: trigger,
                Time_Occured: timeOccurred,
                Meeting_Type: meetingType || "",
                Widget_Source: Widget_Source,
            },
        });

        const logSuccess = logInsertResponse?.data?.[0]?.code === "SUCCESS";
        if (!logSuccess) {
            console.warn("⚠️ Log insert failed:", logInsertResponse);
        }
    } catch (err) {
        console.error("🚨 Error inserting into Log_Module:", err);
    }
};

/**
 * Create a new History record with participants and optional attachment
 */
export const createHistory = async ({
    finalData,
    selectedParticipants,
    attachment,
    onSuccess,
    onError,
}) => {
    try {
        const createConfig = {
            Entity: "History1",
            APIData: { ...finalData },
            Trigger: ["workflow"],
        };

        const createResponse = await ZOHO.CRM.API.insertRecord(createConfig);
        const wasSuccessful = createResponse?.data[0]?.code === "SUCCESS";

        await logResponse({
            name: "Create History1",
            payload: JSON.stringify(finalData),
            response: createResponse,
            result: wasSuccessful ? "Success" : "Error",
            trigger: "Record Create",
            meetingType: finalData?.Type_of_Activity || "",
            Widget_Source: "Contact History",
        });

        if (!wasSuccessful) throw new Error("Failed to create History1 record.");

        const historyId = createResponse.data[0].details.id;

        // Upload attachment if provided
        if (attachment) {
            await zohoApi.file.uploadAttachment({
                module: "History1",
                recordId: historyId,
                data: attachment,
            });
        }

        // Create participant links
        let contactRecordIds = [];
        for (const contact of selectedParticipants) {
            try {
                const contactResponse = await ZOHO.CRM.API.insertRecord({
                    Entity: "History_X_Contacts",
                    APIData: {
                        Contact_History_Info: { id: historyId },
                        Contact_Details: { id: contact.id },
                    },
                    Trigger: ["workflow"],
                });

                if (contactResponse?.data[0]?.code === "SUCCESS") {
                    contactRecordIds.push(contactResponse.data[0].details.id);
                } else {
                    console.warn(`Failed to insert contact for ID ${contact.id}`);
                }
            } catch (error) {
                console.error(`Error inserting contact ${contact.id}:`, error);
            }
        }

        const updatedRecord = {
            id: contactRecordIds[0] || null,
            ...finalData,
            Participants: selectedParticipants,
            historyDetails: {
                name: selectedParticipants.map((c) => c.Full_Name).join(", "),
                id: historyId,
            },
        };

        if (onSuccess) onSuccess(updatedRecord);
        return { success: true, record: updatedRecord };
    } catch (error) {
        await logResponse({
            name: "Create History1",
            payload: JSON.stringify(finalData),
            response: { error: error.message },
            result: "Error",
            trigger: "Record Create",
            meetingType: finalData?.Type_of_Activity || "",
            Widget_Source: "Contact History",
        });
        console.error("Error creating history:", error);
        if (onError) onError(error);
        throw error;
    }
};

/**
 * Update an existing History record with participants and attachment
 */
export const updateHistory = async ({
    selectedRowData,
    finalData,
    selectedParticipants,
    attachment,
    loadedAttachmentFromRecord,
    onSuccess,
    onError,
}) => {
    // Clean up stakeholder if unknown
    if (selectedRowData.stakeHolder === "Unknown") {
        delete selectedRowData.stakeHolder;
    }

    try {
        const historyId =
            selectedRowData?.historyDetails?.id || selectedRowData?.history_id;

        const updateConfig = {
            Entity: "History1",
            RecordID: historyId,
            APIData: {
                id: historyId,
                ...finalData,
                Owner: { id: finalData?.Owner?.id },
            },
            Trigger: ["workflow"],
        };

        const updateResponse = await ZOHO.CRM.API.updateRecord(updateConfig);
        const wasSuccessful = updateResponse?.data[0]?.code === "SUCCESS";

        await logResponse({
            name: `Update History1: ${historyId}`,
            response: updateResponse,
            result: wasSuccessful ? "Success" : "Error",
            trigger: "Record Update",
            meetingType: finalData?.Type_of_Activity || "",
            Widget_Source: "Contact History",
        });

        if (!wasSuccessful) throw new Error("Failed to update record.");

        // Handle attachment update
        await zohoApi.file.deleteAttachment({
            module: "History1",
            recordId: historyId,
            attachment_id: loadedAttachmentFromRecord?.[0]?.id,
        });

        await zohoApi.file.uploadAttachment({
            module: "History1",
            recordId: historyId,
            data: attachment,
        });

        // Sync participants
        const relatedRecordsResponse = await ZOHO.CRM.API.getRelatedRecords({
            Entity: "History1",
            RecordID: historyId,
            RelatedList: "Contacts3",
        });

        const existingContacts = relatedRecordsResponse?.data || [];
        const existingContactIds = existingContacts.map(
            (c) => c.Contact_Details?.id
        );
        const selectedContactIds = selectedParticipants.map((c) => c.id);

        const toDeleteContactIds = existingContactIds.filter(
            (id) => !selectedContactIds.includes(id)
        );
        const toAddContacts = selectedParticipants.filter(
            (c) => !existingContactIds.includes(c.id)
        );

        // Delete removed participants
        for (const id of toDeleteContactIds) {
            const recordToDelete = existingContacts.find(
                (c) => c.Contact_Details?.id === id
            );
            if (recordToDelete?.id) {
                await ZOHO.CRM.API.deleteRecord({
                    Entity: "History_X_Contacts",
                    RecordID: recordToDelete.id,
                });
            }
        }

        // Add new participants
        for (const contact of toAddContacts) {
            try {
                await ZOHO.CRM.API.insertRecord({
                    Entity: "History_X_Contacts",
                    APIData: {
                        Contact_History_Info: { id: historyId },
                        Contact_Details: { id: contact.id },
                        Stakeholder: finalData?.Stakeholder,
                    },
                    Trigger: ["workflow"],
                });
            } catch (error) {
                console.error(`Error inserting contact ${contact.id}:`, error);
            }
        }

        const updatedRecord = {
            id: selectedRowData.id || null,
            ...finalData,
            Participants: selectedParticipants,
            Stakeholder: selectedRowData?.stakeHolder || null,
            historyDetails: {
                ...selectedRowData?.historyDetails,
                name: selectedParticipants.map((c) => c.Full_Name).join(", "),
            },
        };

        if (onSuccess) onSuccess(updatedRecord);
        return { success: true, record: updatedRecord };
    } catch (error) {
        await logResponse({
            name: `Update History1: ${selectedRowData?.history_id || "Unknown"}`,
            response: { error: error.message },
            result: "Error",
            trigger: "Record Update",
            meetingType: finalData?.Type_of_Activity || "",
            Widget_Source: "Contact History",
        });

        console.error("Error updating history:", error);
        if (onError) onError(error);
        throw error;
    }
};

/**
 * Delete a History record and all related participant links
 */
export const deleteHistory = async ({ selectedRowData, onSuccess, onError }) => {
    if (!selectedRowData) return;

    const deleteId =
        selectedRowData?.historyDetails?.id || selectedRowData?.history_id;

    try {
        // Delete related records first
        if (deleteId) {
            const relatedRecordsResponse = await ZOHO.CRM.API.getRelatedRecords({
                Entity: "History1",
                RecordID: deleteId,
                RelatedList: "Contacts3",
            });
            const relatedRecords = relatedRecordsResponse?.data || [];
            const deletePromises = relatedRecords.map((record) =>
                ZOHO.CRM.API.deleteRecord({
                    Entity: "History_X_Contacts",
                    RecordID: record.id,
                })
            );

            await Promise.all(deletePromises);
        }

        // Delete the main record
        const response = await ZOHO.CRM.API.deleteRecord({
            Entity: "History1",
            RecordID: deleteId,
        });

        if (response?.data[0]?.code === "SUCCESS") {
            if (onSuccess) onSuccess({ deleted: true, id: selectedRowData.id });
            return { success: true };
        } else {
            throw new Error("Failed to delete record.");
        }
    } catch (error) {
        console.error("Error deleting record or related records:", error);
        if (onError) onError(error);
        throw error;
    }
};
