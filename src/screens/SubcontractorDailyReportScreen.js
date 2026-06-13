import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorDailyReportBootstrap, submitSubcontractorDailyReport } from '../api/subcontractorApi';

function siteName(site) {
  return site?.site_name || site?.name || site?.label || String(site || '');
}

function pad2(n) { return String(n).padStart(2, '0'); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseISODate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
function isoFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function displayDate(value) {
  const d = parseISODate(value);
  if (!d) return value || 'Select date';
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}
function displayTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return value || 'Select time';
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${pad2(minute)} ${ampm}`;
}
function toTime24(hour12, minute, ampm) {
  let h = Number(hour12) || 12;
  h = Math.max(1, Math.min(12, h));
  let hh = h % 12;
  if (ampm === 'PM') hh += 12;
  return `${pad2(hh)}:${pad2(Math.max(0, Math.min(59, Number(minute) || 0)))}`;
}
function parseTimeParts(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour12: 8, minute: 0, ampm: 'AM' };
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return { hour12: hour, minute, ampm };
}
function splitLines(raw) {
  return String(raw || '').split(/(?:\r?\n)+|\s*,\s*/).map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function clean(v) { return String(v ?? '').trim(); }
function detailFromSubmit(result) {
  if (result?.mode === 'main_daily_report_trigger_flow') return 'Daily report submitted into the main daily report flow.';
  if (result?.delta?.status === 'baseline_created') return 'Daily report submitted. First subcontractor baseline was created.';
  return 'Daily report submitted successfully.';
}


function DateSelectModal({ visible, value, title, onCancel, onSelect }) {
  const base = parseISODate(value) || new Date();
  const [monthCursor, setMonthCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));

  useEffect(() => {
    if (visible) {
      const d = parseISODate(value) || new Date();
      setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [visible, value]);

  const selected = parseISODate(value);
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);

  function moveMonth(delta) {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <View style={styles.calendarHeader}>
            <Pressable style={styles.calendarNavButton} onPress={() => moveMonth(-1)}><Text style={styles.calendarNavText}>‹</Text></Pressable>
            <Text style={styles.calendarMonth}>{monthCursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <Pressable style={styles.calendarNavButton} onPress={() => moveMonth(1)}><Text style={styles.calendarNavText}>›</Text></Pressable>
          </View>
          <View style={styles.weekRow}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <Text key={d} style={styles.weekLabel}>{d}</Text>)}</View>
          <View style={styles.dayGrid}>
            {cells.map((day, idx) => {
              const isSelected = !!day && selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day;
              return (
                <Pressable
                  key={`${idx}-${day || 'blank'}`}
                  disabled={!day}
                  style={[styles.dayCell, isSelected && styles.dayCellSelected, !day && styles.dayCellBlank]}
                  onPress={() => onSelect(isoFromDate(new Date(year, month, day)))}
                >
                  <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{day || ''}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
            <Pressable style={styles.modalToday} onPress={() => onSelect(todayISO())}><Text style={styles.modalTodayText}>Today</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TimeSelectModal({ visible, value, title, onCancel, onSelect }) {
  const [hour12, setHour12] = useState(8);
  const [minute, setMinute] = useState(0);
  const [ampm, setAmpm] = useState('AM');

  useEffect(() => {
    if (visible) {
      const parts = parseTimeParts(value);
      setHour12(parts.hour12);
      setMinute(parts.minute);
      setAmpm(parts.ampm);
    }
  }, [visible, value]);

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.timePreview}>{`${hour12}:${pad2(minute)} ${ampm}`}</Text>
          <Text style={styles.pickerSectionLabel}>Hour</Text>
          <View style={styles.choiceGrid}>
            {hours.map((h) => (
              <Pressable key={h} style={[styles.choicePill, h === hour12 && styles.choicePillSelected]} onPress={() => setHour12(h)}>
                <Text style={[styles.choiceText, h === hour12 && styles.choiceTextSelected]}>{h}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.pickerSectionLabel}>Minute</Text>
          <View style={styles.choiceGrid}>
            {minutes.map((m) => (
              <Pressable key={m} style={[styles.choicePill, m === minute && styles.choicePillSelected]} onPress={() => setMinute(m)}>
                <Text style={[styles.choiceText, m === minute && styles.choiceTextSelected]}>{pad2(m)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.ampmRow}>
            {['AM', 'PM'].map((part) => (
              <Pressable key={part} style={[styles.ampmButton, ampm === part && styles.ampmButtonSelected]} onPress={() => setAmpm(part)}>
                <Text style={[styles.ampmText, ampm === part && styles.ampmTextSelected]}>{part}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
            <Pressable style={styles.modalSave} onPress={() => onSelect(toTime24(hour12, minute, ampm))}><Text style={styles.modalSaveText}>Use Time</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function SubcontractorDailyReportScreen({ session, project, page, onBack, onHome }) {
  const portalUrl = session?.portalUrl;
  const token = session?.access_token;
  const selectedSiteName = siteName(project);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('legacy_subcontractor_report');
  const [routeVersion, setRouteVersion] = useState('');
  const [companyPrefix, setCompanyPrefix] = useState('Company');
  const [datePicker, setDatePicker] = useState(null);
  const [timePicker, setTimePicker] = useState(null);

  const [reportDate, setReportDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [nextShiftDate, setNextShiftDate] = useState(tomorrowISO());
  const [summary, setSummary] = useState('');
  const [photos, setPhotos] = useState([]);

  const [techNames, setTechNames] = useState('');
  const [accomplishments, setAccomplishments] = useState('');
  const [activitiesNextShift, setActivitiesNextShift] = useState('');
  const [pmActions, setPmActions] = useState('');
  const [issues, setIssues] = useState('');

  const [workersOnSite, setWorkersOnSite] = useState('0');
  const [itemsAttention, setItemsAttention] = useState('');

  const enhanced = mode === 'main_daily_report_trigger_flow';

  const load = useCallback(async (showRefresh = false) => {
    if (!selectedSiteName) {
      setError('Select a project first.');
      setLoading(false);
      return;
    }
    setError('');
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await loadSubcontractorDailyReportBootstrap(portalUrl, token, selectedSiteName);
      setMode(data?.mode || (data?.enhanced_mode ? 'main_daily_report_trigger_flow' : 'legacy_subcontractor_report'));
      setRouteVersion(data?.route_version || '');
      setCompanyPrefix(clean(data?.company_prefix) || 'Company');
      setReportDate(data?.default_report_date || todayISO());
      setNextShiftDate(data?.default_next_shift_date || tomorrowISO());
    } catch (err) {
      setError(err?.message || 'Unable to load daily report.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [portalUrl, token, selectedSiteName]);

  useEffect(() => { load(false); }, [load]);

  const photoLabel = useMemo(() => {
    if (!photos.length) return 'No photos selected';
    return `${photos.length} photo${photos.length === 1 ? '' : 's'} selected`;
  }, [photos.length]);

  async function addPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos Permission Needed', 'Please allow photo access to attach daily report photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.86,
      exif: false,
    });
    if (result.canceled) return;
    setPhotos((prev) => [...prev, ...(result.assets || [])]);
  }

  function validate() {
    if (!clean(selectedSiteName)) return 'Site is required.';
    if (!clean(reportDate)) return 'Report Date is required.';
    if (!clean(startTime)) return 'Start Time is required.';
    if (!clean(endTime)) return 'End Time is required.';
    if (!clean(nextShiftDate)) return 'Next Shift Date is required.';
    if (!clean(summary)) return 'Summary is required.';
    if (enhanced) {
      if (!splitLines(techNames).length) return "Enter at least one tech name for 'Techs On Site'.";
      if (!splitLines(accomplishments).length) return 'Accomplishments for this period is required.';
      if (!clean(activitiesNextShift)) return 'Activities for next period is required.';
    } else {
      if (!clean(workersOnSite)) return 'Workers On Site is required.';
      if (!clean(accomplishments)) return 'Accomplishments is required.';
      if (!clean(itemsAttention)) return `Items that need to be brought to ${companyPrefix} attention is required.`;
    }
    return '';
  }

  async function handleSubmit() {
    const validation = validate();
    if (validation) {
      Alert.alert('Daily Report', validation);
      return;
    }

    const fields = {
      site_name: selectedSiteName,
      report_date: reportDate,
      start_time: startTime,
      end_time: endTime,
      summary: clean(summary),
    };

    if (enhanced) {
      fields.next_shift_date = nextShiftDate;
      fields.activities_next_shift = clean(activitiesNextShift);
      fields.tech_names_json = JSON.stringify(splitLines(techNames));
      fields.accomplishments_json = JSON.stringify({ accomplishments: splitLines(accomplishments) });
      fields.action_items = JSON.stringify({ pm_actions: splitLines(pmActions), issues: splitLines(issues) });
      fields.chart_configuration = 'false';
      fields.photo_category = 'construction';
    } else {
      fields.next_shift = nextShiftDate;
      fields.accomplishments = clean(accomplishments);
      fields.workers_on_site = String(parseInt(workersOnSite || '0', 10) || 0);
      fields.items_attention = clean(itemsAttention);
    }

    setSubmitting(true);
    try {
      const result = await submitSubcontractorDailyReport(portalUrl, token, fields, photos);
      Alert.alert('Daily Report Submitted', detailFromSubmit(result), [
        { text: 'OK', onPress: onBack },
      ]);
    } catch (err) {
      Alert.alert('Submit Failed', err?.message || 'Unable to submit daily report.');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (label, value, setter, props = {}) => {
    const { hint, placeholder, multiline, keyboardType, autoCapitalize, labelStyle, ...inputProps } = props;
    return (
      <View style={styles.field}>
        <Text style={[styles.label, labelStyle]}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={setter}
          placeholder={placeholder || label}
          placeholderTextColor="#94a3b8"
          style={[styles.input, multiline && styles.textarea]}
          multiline={!!multiline}
          keyboardType={keyboardType || 'default'}
          autoCapitalize={autoCapitalize || 'sentences'}
          {...inputProps}
        />
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
    );
  };

  const selectField = (label, value, onPress, type = 'date') => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={({ pressed }) => [styles.selectInput, pressed && styles.pressed]} onPress={onPress}>
        <Text style={[styles.selectInputText, !value && styles.selectPlaceholder]}>{type === 'time' ? displayTime(value) : displayDate(value)}</Text>
        <Text style={styles.selectChevron}>{type === 'time' ? '🕒' : '📅'}</Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenShell
      title={page?.label || 'Daily Reports'}
      subtitle={selectedSiteName}
      onBack={onBack}
      onHome={onHome}
      backgroundSource={require('../../assets/subcontractor-home-background.png')}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.loading}><ActivityIndicator size="large" color="#fff" /><Text style={styles.loadingText}>Loading daily report…</Text></View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          >
            <View style={styles.hero}>
              <Text style={styles.heroEyebrow}>Subcontractor Daily Report</Text>
              <Text style={styles.heroTitle}>{selectedSiteName || 'Selected Project'}</Text>
              <View style={[styles.modePill, enhanced ? styles.modeEnhanced : styles.modeLegacy]}>
                <Text style={styles.modeText}>{enhanced ? 'Main Daily Report Flow' : 'Subcontractor Report Flow'}</Text>
              </View>
            </View>

            {!!error && <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View>}

            <View style={styles.card}>
              {selectField('Report Date', reportDate, () => setDatePicker('report_date'), 'date')}
              <View style={styles.row}>
                <View style={styles.rowItem}>{selectField('Start Time', startTime, () => setTimePicker('start_time'), 'time')}</View>
                <View style={styles.rowItem}>{selectField('End Time', endTime, () => setTimePicker('end_time'), 'time')}</View>
              </View>
              {selectField('Next Shift Date', nextShiftDate, () => setDatePicker('next_shift_date'), 'date')}

              {enhanced ? (
                <>
                  {field('Techs On Site', techNames, setTechNames, { multiline: true, placeholder: 'One name per line, or comma separated', hint: 'Required for the main daily report flow.' })}
                  {field('Summary', summary, setSummary, { multiline: true, placeholder: 'Enter summary…' })}
                  {field('Accomplishments for this period', accomplishments, setAccomplishments, { multiline: true, placeholder: 'One item per line, or comma separated' })}
                  {field('Activities for next period', activitiesNextShift, setActivitiesNextShift, { multiline: true, placeholder: 'Describe upcoming activities…' })}
                  {field(`Items you need your ${companyPrefix} PM to do (leave blank if not needed)`, pmActions, setPmActions, { multiline: true, placeholder: 'One action per line, or comma separated', labelStyle: styles.blueLabel })}
                  {field(`Issues/actions to bring to the ${companyPrefix} customer (leave blank if not needed)`, issues, setIssues, { multiline: true, placeholder: 'One issue per line, or comma separated', labelStyle: styles.redLabel })}
                </>
              ) : (
                <>
                  {field('Workers On Site', workersOnSite, setWorkersOnSite, { keyboardType: 'number-pad', autoCapitalize: 'none' })}
                  {field('Summary', summary, setSummary, { multiline: true, placeholder: 'High-level summary…' })}
                  {field('Accomplishments', accomplishments, setAccomplishments, { multiline: true, placeholder: 'What was completed today…' })}
                  {field(`Items that need to be brought to ${companyPrefix} attention`, itemsAttention, setItemsAttention, { multiline: true, placeholder: `Anything ${companyPrefix} should know / follow up on…` })}
                </>
              )}

              <View style={styles.photoCard}>
                <Text style={styles.label}>Photos (optional)</Text>
                <Text style={styles.photoText}>{photoLabel}</Text>
                <View style={styles.photoActions}>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={addPhotos}>
                    <Text style={styles.secondaryButtonText}>Add Photos</Text>
                  </Pressable>
                  {photos.length ? (
                    <Pressable style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]} onPress={() => setPhotos([])}>
                      <Text style={styles.clearButtonText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <Pressable style={({ pressed }) => [styles.submitButton, (pressed || submitting) && styles.pressed]} disabled={submitting} onPress={handleSubmit}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Daily Report</Text>}
              </Pressable>
              {!!routeVersion && <Text style={styles.versionText}>{routeVersion}</Text>}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <DateSelectModal
        visible={!!datePicker}
        title={datePicker === 'next_shift_date' ? 'Select Next Shift Date' : 'Select Report Date'}
        value={datePicker === 'next_shift_date' ? nextShiftDate : reportDate}
        onCancel={() => setDatePicker(null)}
        onSelect={(value) => {
          if (datePicker === 'next_shift_date') setNextShiftDate(value); else setReportDate(value);
          setDatePicker(null);
        }}
      />
      <TimeSelectModal
        visible={!!timePicker}
        title={timePicker === 'end_time' ? 'Select End Time' : 'Select Start Time'}
        value={timePicker === 'end_time' ? endTime : startTime}
        onCancel={() => setTimePicker(null)}
        onSelect={(value) => {
          if (timePicker === 'end_time') setEndTime(value); else setStartTime(value);
          setTimePicker(null);
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#fff', fontWeight: '900' },
  hero: { backgroundColor: 'rgba(8,24,44,0.9)', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(147,197,253,0.22)', padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  heroEyebrow: { color: '#93c5fd', fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '900', marginTop: 5 },
  modePill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 12, borderWidth: 1 },
  modeEnhanced: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  modeLegacy: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  modeText: { color: colors.text, fontWeight: '900', fontSize: 12 },
  errorCard: { backgroundColor: 'rgba(127,29,29,0.86)', borderColor: 'rgba(254,202,202,0.35)', borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14 },
  errorText: { color: '#fee2e2', fontWeight: '800', textAlign: 'center' },
  card: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(190,214,239,0.9)', padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 3 },
  row: { flexDirection: 'row', gap: 10 },
  rowItem: { flex: 1 },
  field: { marginBottom: 12 },
  label: { color: colors.text, fontWeight: '900', fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontWeight: '800' },
  selectInput: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 12, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectInputText: { color: colors.text, fontWeight: '900', fontSize: 14 },
  selectPlaceholder: { color: '#94a3b8' },
  selectChevron: { fontSize: 17, marginLeft: 8 },
  textarea: { minHeight: 104, textAlignVertical: 'top' },
  hint: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 5 },
  blueLabel: { color: '#1d4ed8' },
  redLabel: { color: '#dc2626' },
  photoCard: { backgroundColor: '#f8fbff', borderWidth: 1, borderColor: '#dfe8f5', borderRadius: 17, padding: 12, marginBottom: 14 },
  photoText: { color: colors.muted, fontWeight: '800', marginBottom: 10 },
  photoActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  secondaryButton: { backgroundColor: '#eef6ff', borderWidth: 1, borderColor: '#c8def6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: colors.blue, fontWeight: '900' },
  clearButton: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  clearButtonText: { color: colors.red, fontWeight: '900' },
  submitButton: { minHeight: 50, borderRadius: 17, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', shadowColor: '#1d4ed8', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  versionText: { color: colors.muted, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.58)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 430, backgroundColor: '#fff', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: '#dbeafe', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calendarNavButton: { width: 42, height: 40, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bfdbfe' },
  calendarNavText: { color: colors.blue, fontSize: 28, lineHeight: 30, fontWeight: '900' },
  calendarMonth: { color: colors.text, fontWeight: '900', fontSize: 16 },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: { flex: 1, textAlign: 'center', color: colors.muted, fontWeight: '900', fontSize: 11 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginVertical: 2 },
  dayCellBlank: { opacity: 0 },
  dayCellSelected: { backgroundColor: colors.blue },
  dayText: { color: colors.text, fontWeight: '900' },
  dayTextSelected: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 14 },
  modalCancel: { borderRadius: 14, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  modalCancelText: { color: colors.muted, fontWeight: '900' },
  modalToday: { borderRadius: 14, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  modalTodayText: { color: colors.blue, fontWeight: '900' },
  modalSave: { borderRadius: 14, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: colors.blue },
  modalSaveText: { color: '#fff', fontWeight: '900' },
  timePreview: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  pickerSectionLabel: { color: colors.muted, fontWeight: '900', marginTop: 6, marginBottom: 7, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choicePill: { minWidth: 45, minHeight: 39, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  choicePillSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  choiceText: { color: colors.text, fontWeight: '900' },
  choiceTextSelected: { color: '#fff' },
  ampmRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ampmButton: { flex: 1, borderRadius: 16, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  ampmButtonSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  ampmText: { color: colors.text, fontWeight: '900' },
  ampmTextSelected: { color: '#fff' },
  pressed: { opacity: 0.72 },
});
