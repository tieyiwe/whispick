import { useMemo, useState } from "react";
import { AsYouType } from "libphonenumber-js/min";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { COUNTRIES, detectDefaultCountry, flagEmoji } from "@/lib/countries";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// A country picker + national-number field that combine into a single E.164
// value, so the person confirming their phone number never has to know or
// type a country code themselves — picking "United States" and typing
// "555 123 4567" produces "+15551234567" automatically. Used specifically
// for OWN-number confirmation (PhoneVerificationFlow); the "send to
// someone else's number" fields elsewhere (SendTextWhisp, SendWhisp) are a
// different use case — the sender usually already knows the recipient's
// full number as given to them — and are intentionally left as plain inputs.
export function CountryPhoneInput({
  onChange,
  disabled,
}: {
  onChange: (e164: string) => void;
  disabled?: boolean;
}) {
  const [country, setCountry] = useState(() => detectDefaultCountry());
  const [nationalNumber, setNationalNumber] = useState("");
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => COUNTRIES.find((c) => c.iso2 === country) ?? COUNTRIES[0], [country]);

  function emit(nextCountry: string, nextNational: string) {
    const digits = nextNational.replace(/\D/g, "");
    const dialCode = COUNTRIES.find((c) => c.iso2 === nextCountry)?.dialCode ?? "";
    onChange(digits ? `+${dialCode}${digits}` : "");
  }

  function handleNationalChange(raw: string) {
    // AsYouType formats as the person types (e.g. "(555) 123-4567" for a US
    // number) purely for display — the underlying E.164 value emitted above
    // is always derived from the raw digits, not this formatted string.
    const formatted = new AsYouType(country as any).input(raw);
    setNationalNumber(formatted);
    emit(country, formatted);
  }

  function handleCountrySelect(iso2: string) {
    setCountry(iso2);
    setOpen(false);
    emit(iso2, nationalNumber);
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="shrink-0 justify-between gap-1.5 bg-input/50 border-border/50 rounded-xl px-2.5 font-normal"
            data-testid="button-country-select"
          >
            <span className="flex items-center gap-1.5">
              <span>{flagEmoji(selected.iso2)}</span>
              <span className="text-sm text-muted-foreground">+{selected.dialCode}</span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search country..." data-testid="input-country-search" />
            <CommandList>
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={c.iso2}
                    value={`${c.name} +${c.dialCode}`}
                    onSelect={() => handleCountrySelect(c.iso2)}
                    data-testid={`option-country-${c.iso2.toLowerCase()}`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", c.iso2 === selected.iso2 ? "opacity-100" : "opacity-0")} />
                    <span className="mr-2">{flagEmoji(c.iso2)}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">+{c.dialCode}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Input
        className="flex-1 bg-input/50 border-border/50 rounded-xl"
        placeholder="555 123 4567"
        type="tel"
        inputMode="tel"
        value={nationalNumber}
        onChange={(e) => handleNationalChange(e.target.value)}
        disabled={disabled}
        data-testid="input-phone-verification-number"
      />
    </div>
  );
}
