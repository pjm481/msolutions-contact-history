import { useEffect, useRef, useState } from "react";
import { Autocomplete, TextField } from "@mui/material";

export default function Stakeholder({ formData, handleInputChange, ZOHO }) {
  const [stakeholders, setStakeholders] = useState([]);
  const [selectedStakeholder, setSelectedStakeholder] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const expectedIdRef = useRef(null);
  const lastFetchedIdRef = useRef(null);

  useEffect(() => {
    if (!formData?.stakeHolder) {
      expectedIdRef.current = null;
      lastFetchedIdRef.current = null;
      setSelectedStakeholder(null);
      setInputValue("");
      return;
    }

    if (formData.stakeHolder.name) {
      setSelectedStakeholder(formData.stakeHolder);
      setInputValue(formData.stakeHolder.name);
      return;
    }

    const id = formData.stakeHolder.id;
    if (!id || !ZOHO) return;

    if (lastFetchedIdRef.current === id) {
      setSelectedStakeholder(formData.stakeHolder);
      setInputValue(formData.stakeHolder.name || "");
      return;
    }

    lastFetchedIdRef.current = id;
    expectedIdRef.current = id;

    ZOHO.CRM.API.getRecord({
      Entity: "Accounts",
      RecordID: id,
      approved: "both",
    })
      .then((response) => {
        if (expectedIdRef.current !== id) return;
        const name = response?.data?.[0]?.Account_Name || "";
        if (name) {
          const full = { id, name };
          handleInputChange("stakeHolder", full);
          setSelectedStakeholder(full);
          setInputValue(name);
        } else {
          setSelectedStakeholder(formData.stakeHolder);
          setInputValue("");
        }
      })
      .catch((err) => {
        if (expectedIdRef.current !== id) return;
        console.error("Error fetching stakeholder by id:", err);
        setSelectedStakeholder(formData.stakeHolder);
        setInputValue("");
      });
  }, [formData, ZOHO, handleInputChange]);

  const fetchStakeholders = async (query) => {
    if (!ZOHO || !query.trim()) return;

    try {
      const results = await ZOHO.CRM.API.searchRecord({
        Entity: "Accounts",
        Type: "word",
        Query: query.trim(),
      });
      if (results.data) {
        const formattedResults = results.data.map((record) => ({
          id: record.id,
          name: record.Account_Name,
        }));
        setStakeholders(formattedResults);
      }
    } catch (error) {
      console.error("Error fetching stakeholders:", error);
    }
  };

  const handleInputChangeWithDebounce = (event, newValue) => {
    setInputValue(newValue);

    if (newValue) {
      const debounceTimeout = setTimeout(
        () => fetchStakeholders(newValue),
        500
      );
      return () => clearTimeout(debounceTimeout);
    }
  };

  const handleChange = (event, newValue) => {
    setSelectedStakeholder(newValue);
    handleInputChange("stakeHolder", newValue);
  };

  return (
    <Autocomplete
      options={stakeholders || []}
      getOptionLabel={(option) => option?.name || ""}
      value={selectedStakeholder}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={handleInputChangeWithDebounce}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Stakeholder"
          variant="standard"
          sx={{ 
            "& .MuiInputLabel-root": { fontSize: "9pt" },  // Label size
            "& .MuiInputBase-input": { fontSize: "9pt" }   // Input text size
          }}
        />
      )}
    />
  );
}
