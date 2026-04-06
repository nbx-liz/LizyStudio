import { X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface ChoiceInputProps {
  choices: string[];
  onChange: (choices: string[]) => void;
  availableOptions?: string[];
}

/**
 * Generic choice editor.
 *
 * - With `availableOptions`: renders toggleable chip badges.
 * - Without `availableOptions` (free-text mode): renders a text input where
 *   pressing Enter or typing a comma adds the value as a removable chip tag.
 */
export function ChoiceInput({
  choices,
  onChange,
  availableOptions,
}: ChoiceInputProps) {
  const [inputValue, setInputValue] = useState("");

  if (availableOptions !== undefined) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {availableOptions.map((opt) => {
          const selected = choices.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-label={opt}
              aria-pressed={selected}
              data-selected={String(selected)}
              onClick={() => {
                const next = selected
                  ? choices.filter((c) => c !== opt)
                  : [...choices, opt];
                onChange(next);
              }}
            >
              <Badge
                variant={selected ? "default" : "outline"}
                className="cursor-pointer text-xs"
              >
                {opt}
              </Badge>
            </button>
          );
        })}
      </div>
    );
  }

  const commitValues = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const toAdd = parts.filter((p) => !choices.includes(p));
    onChange([...choices, ...toAdd]);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitValues(inputValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const removeChoice = (choice: string) => {
    onChange(choices.filter((c) => c !== choice));
  };

  return (
    <div className="space-y-2">
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((choice) => (
            <Badge
              key={choice}
              variant="default"
              className="text-xs flex items-center gap-1 pr-1"
            >
              {choice}
              <button
                type="button"
                aria-label={`remove ${choice}`}
                className="ml-0.5 rounded-full hover:bg-white/20 p-0.5"
                onClick={() => removeChoice(choice)}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a value and press Enter"
        className="h-7 text-xs"
      />
    </div>
  );
}
