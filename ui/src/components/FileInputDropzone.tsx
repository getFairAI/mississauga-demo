import { Button, IconButton, InputAdornment, Stack, useTheme, Checkbox, FormControlLabel } from "@mui/material";
import FormControl from "@mui/material/FormControl";
import TextField from "@mui/material/TextField";
import { motion } from "motion/react";
import { useSnackbar } from "notistack";
import { useState, type ChangeEvent, type DragEventHandler } from "react";
import ClearIcon from "@mui/icons-material/Clear";
import { printSize } from "../utils";
import { openProgressSocket, sendOpenAI } from "../api";

const MAX_UPLOAD_SIZE = 2048 * 1024 * 1000; // 2GB in bytes

const ChosenFilesRow = ({
  file,
  idx,
  handleRemove,
}: {
  file: File;
  idx: number;
  handleRemove: (idx: number) => void;
}) => {
  const theme = useTheme();

  return (
    <TextField
      value={file?.name}
      disabled={true}
      multiline
      minRows={1}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <IconButton
              aria-label="Remove"
              onClick={() => handleRemove(idx)}
              className="plausible-event-name=Remove+File+Click"
            >
              <ClearIcon />
            </IconButton>
          </InputAdornment>
        ),
        endAdornment: (
          <>
            <InputAdornment position="start">{printSize(file)}</InputAdornment>
          </>
        ),
        sx: {
          background: theme.palette.background.default,
          fontStyle: "normal",
          fontWeight: 400,
          fontSize: "20px",
          lineHeight: "16px",
          width: "100%",
          marginTop: "10px",
          borderRadius: "8px",
        },
        readOnly: true,
      }}
    />
  );
};

const FileInputDropZone = () => {
  const theme = useTheme();
  const [files, setFiles] = useState<File[]>([]);
  const [hasFileDrag, setHasFileDrag] = useState(false);
  const [diarize, setDiarize] = useState(false);

  const { enqueueSnackbar } = useSnackbar();


  const handleDragEnter: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHasFileDrag(true);
  };

  const handleDragLeave: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHasFileDrag(false);
  };

  const handleDragOver: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHasFileDrag(true);
  };

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setHasFileDrag(false);
    // field.onChange(event.dataTransfer.files[0]);
    if (
      event &&
      event.dataTransfer &&
      event.dataTransfer.files &&
      event.dataTransfer.files.length > 0
    ) {
      addFiles(event.dataTransfer.files);
    } else {
      setFiles([]);
    }
  };

  const addFiles = (uploadedFiles: FileList) => {
    Array.from(uploadedFiles).map((file) => {
      if (
        (!file.type.includes('video')) ||
        file.size > MAX_UPLOAD_SIZE
      ) {
        enqueueSnackbar(
          "The file you selected has an unexpected type or is too big. Please select a video with a maximum of " +
            (MAX_UPLOAD_SIZE / 1024 / 1000).toFixed(2) +
            " MB",
          {
            variant: "error",
            style: { fontWeight: 700 },
            autoHideDuration: 5000,
          },
        );
        // skip adding this file
      } else {
        // add file to files list
        setFiles((files) => files.concat(file));
        // setFilesInput()
      }
    });
  };

  const onFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files);
    } else {
      setFiles([]);
    }
  };

  const handleRemoveFile = (idx: number) => {
    console.log(idx)
    const arrayCopy = [ ...files ]; // do not manipulate files directly
    arrayCopy.splice(idx, 1);
    console.log(arrayCopy)
    setFiles(arrayCopy);
  };

  async function handleTranscribe() {
    const { room_id } = await sendOpenAI(files[0], undefined, diarize);
    openProgressSocket(room_id, (msg) => {
      console.log('update', msg); // stages, deltas, final transcript
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: "-20px" }}
      animate={{ opacity: 1, y: 0 }}
    >
      <p className="font-medium text-lg mt-5 text-center">
        Choose the videos you want to transcribe
      </p>
      <Stack>
        {files.length > 0 &&
          files.map((el, idx) => (
            <ChosenFilesRow
              key={el.name+idx}
              file={el}
              idx={idx}
              handleRemove={handleRemoveFile}
            />
          ))}
      </Stack>
      <FormControl variant="outlined" fullWidth margin="normal">
        <TextField
          multiline
          minRows={1}
          value={"Drop your files here or click to choose"}
          inputProps={{
            style: { textAlign: "center", cursor: "pointer" },
          }}
          InputProps={{
            readOnly: true,
            sx: {
              transform: hasFileDrag ? "scale(1.02)" : "scale(1)",
              filter: hasFileDrag
                ? `blur(2px)  ${
                    theme.palette.mode === "dark"
                      ? "contrast(0.65)"
                      : "brightness(0.9)"
                  }`
                : theme.palette.mode === "dark"
                  ? "contrast(0.65)"
                  : "brightness(0.9)",
              backdropFilter: "blur(2px)",
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: hasFileDrag
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              },
            },
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() =>
            (
              document.querySelector(
                "input[name=imageFileDropped]",
              ) as HTMLButtonElement
            )?.click()
          }
        />
      </FormControl>
      <input
        type="file"
        hidden
        name={"imageFileDropped"}
        accept="video/*"
        multiple={true}
        onChange={onFilesChange}
      />
      <FormControlLabel
        control={<Checkbox checked={diarize} onChange={(_, checked) => setDiarize(checked)} />}
        label="Identify speakers (diarize)"
        sx={{ mt: 1 }}
      />
      <Button variant='outlined' onClick={handleTranscribe}>{'Transcribe'}</Button>
    </motion.div>
  );
};

export default FileInputDropZone;
