import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/** Strict E.164 normalization shared by forms, imports, and webhook matching. */
export function normalizePhone(value: string, country?: string): string {
  const configured = (country || process.env.DEFAULT_PHONE_COUNTRY || "IN").toUpperCase();
  if (!isSupportedCountry(configured)) throw new Error("The default phone country must be a supported two-letter country code.");
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 60 || /[a-z]/i.test(cleaned)) throw new Error("Enter a valid phone number, including its country code where needed.");
  const phone = parsePhoneNumberFromString(cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned, configured as CountryCode);
  if (!phone?.isValid() || phone.ext) throw new Error("Enter a valid phone number without an extension.");
  return phone.number;
}
