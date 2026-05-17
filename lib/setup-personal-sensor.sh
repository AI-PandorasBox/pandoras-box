# =============================================================================
# setup-personal-sensor.sh -- the Personal Sensor Layer (ambient signal layer) + Watch companion (one module)
# the Personal Sensor Layer is the sensor; the watch is the surface. They install together.
# =============================================================================

run_personal_sensor_setup() {
  if [[ "${PBOX_DRY_RUN_ACTIVE:-0}" == "1" ]]; then
    info_msg "[DRY-RUN] $FUNCNAME skipped (interactive prompts)"
    return 0
  fi
  print_module_info_card \
    "the Personal Sensor Layer + Watch (personal intelligence layer)" \
    "the Personal Sensor Layer is a passive sensor daemon: it watches your calendar proximity, unread email count, named places (geofencing), step count, heart rate, and free-time gaps. It surfaces signals to your Personal Assistant, who decides whether to push them to you (no LLM cost at the sensor layer; LLM only fires when the assistant decides to act). The Watch companion is the surface where many of those signals land -- voice input, notification cards, urgent-item pings -- on Wear OS or Apple Watch. They install together because the Personal Sensor Layer is most useful with a watch you check often." \
    "Optional but useful: Pixel/Galaxy Watch (Wear OS 4+) OR Apple Watch (Series 6+, watchOS 10+). Phone with Tailscale running. For named places: addresses you want geofenced (home, office, regular client sites). For health signals: Google Fit / Apple Health permission grant on the phone." \
    "Free. The watch app is sideloaded (Wear OS) or via the iOS companion app -- no app store fee." \
    "~10 minutes (longer if you do not have the phone-side Tailscale set up yet)"

  prompt_yes_no "Set up the Personal Sensor Layer + Watch?" m_choice "no"
  if [[ "$m_choice" != "yes" ]]; then
    info_msg "Skipping the Personal Sensor Layer. The Personal Assistant works without it; you just lose ambient signals."
    return 0
  fi

  echo ""
  echo "  ${C_BOLD}Step 1 -- Named places (geofencing)${C_RESET}"
  echo ""
  echo "  Add the locations you want the Personal Sensor Layer to know about. The assistant uses"
  echo "  these for context (e.g. 'when you arrive at home...', 'leave for work"
  echo "  in 20 min based on traffic'). Skip the prompt by pressing Return."
  echo ""

  declare -a PERSONAL_SENSOR_PLACES
  while true; do
    local p_label=""
    read -rp "  Place name (e.g. Home, Office) -- blank to finish: " p_label
    [[ -z "$p_label" ]] && break
    local p_addr=""
    prompt_required "Address for $p_label" p_addr
    PERSONAL_SENSOR_PLACES+=("$p_label|$p_addr")
    echo ""
  done

  if [[ ${#PERSONAL_SENSOR_PLACES[@]} -eq 0 ]]; then
    info_msg "No named places added. You can add them later via the Personal Assistant."
  else
    info_msg "Added ${#PERSONAL_SENSOR_PLACES[@]} place(s). Geocoding will run on first start."
  fi

  echo ""
  echo "  ${C_BOLD}Step 2 -- Watch platform${C_RESET}"
  echo ""
  echo "    1) Wear OS (Pixel Watch, Galaxy Watch, etc.)"
  echo "    2) Apple Watch"
  echo "    3) Both"
  echo "    4) No watch yet (the Personal Sensor Layer still runs; signals surface on the phone)"
  read -rp "  [1-4]: " w_plat
  w_plat="${w_plat:-4}"

  if [[ "$w_plat" != "4" ]]; then
    echo ""
    echo "  Phone-side install instructions will be saved to:"
    echo "    $INSTALL_PATH/docs/watch-setup.md"
    echo ""
    echo "  After this installer finishes:"
    echo "    1. Install the Pandoras Box phone app from the doc above"
    echo "    2. Sign in to your Tailnet on the phone"
    echo "    3. Grant Google Fit / Apple Health permissions when prompted"
    echo "    4. Pair your watch via the phone app"
    echo ""
    press_enter_to_continue
  fi

  echo ""
  echo "  ${C_BOLD}Step 3 -- Active mode default schedule${C_RESET}"
  echo ""
  echo "  Active mode is when the Personal Sensor Layer pushes proactively (taps you with reminders"
  echo "  before they're due, surfaces gone-quiet contacts, etc.). Outside the"
  echo "  window, the Personal Sensor Layer still senses but stays silent. Weekend default: off."
  echo ""
  prompt_with_default "Active mode start hour (24h)" "8" PERSONAL_SENSOR_AM_START
  prompt_with_default "Active mode end hour (24h)" "20" PERSONAL_SENSOR_AM_END
  prompt_yes_no "Active mode on weekends?" PERSONAL_SENSOR_WKEND "no"

  export PBOX_WATCH_PLATFORM="$w_plat"
  export PERSONAL_SENSOR_AM_START PERSONAL_SENSOR_AM_END PERSONAL_SENSOR_WKEND
  export PERSONAL_SENSOR_PLACES_LIST="$(IFS=$'\n'; echo "${PERSONAL_SENSOR_PLACES[*]}")"

  echo ""
  success_msg "the Personal Sensor Layer + Watch configured."
  echo ""
}
