declare module 'tz-lookup' {
  /**
   * Resolve a latitude/longitude pair to an IANA timezone identifier
   * (e.g. "Australia/Sydney"). Throws on out-of-range coords; we catch
   * and fall back to a sensible default at every call site.
   */
  const tzlookup: (lat: number, lng: number) => string
  export default tzlookup
}
