import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
function splitLines(raw) {
  return String(raw || '').split(/(?:\r?\n)+|\s*,\s*/).map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function clean(v) { return String(v ?? '').trim(); }
function detailFromSubmit(result) {
  if (result?.mode === 'main_daily_report_trigger_flow') return 'Daily report submitted into the main daily report flow.';
  if (result?.delta?.status === 'baseline_created') return 'Daily report submitted. First subcontractor baseline was created.';
  return 'Daily report submitted successfully.';
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
    if (!clean(summary)) return 'Summary is required.';
    if (enhanced) {
      if (!splitLines(techNames).length) return "Enter at least one tech name for 'Techs On Site'.";
      if (!clean(activitiesNextShift)) return 'Activities for next period is required.';
    } else if (!clean(nextShiftDate)) {
      return 'Next Shift Date is required.';
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
    const { hint, placeholder, multiline, keyboardType, autoCapitalize, ...inputProps } = props;
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
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
              {field('Report Date', reportDate, setReportDate, { placeholder: 'YYYY-MM-DD', autoCapitalize: 'none' })}
              <View style={styles.row}>
                <View style={styles.rowItem}>{field('Start Time', startTime, setStartTime, { placeholder: 'HH:MM', autoCapitalize: 'none' })}</View>
                <View style={styles.rowItem}>{field('End Time', endTime, setEndTime, { placeholder: 'HH:MM', autoCapitalize: 'none' })}</View>
              </View>
              {field(enhanced ? 'Next Shift Date' : 'Next Shift Date', nextShiftDate, setNextShiftDate, { placeholder: 'YYYY-MM-DD', autoCapitalize: 'none', hint: enhanced ? 'Leave blank if the project is completed.' : '' })}

              {enhanced ? (
                <>
                  {field('Techs On Site', techNames, setTechNames, { multiline: true, placeholder: 'One name per line, or comma separated', hint: 'Required for the main daily report flow.' })}
                  {field('Summary', summary, setSummary, { multiline: true, placeholder: 'Enter summary…' })}
                  {field('Accomplishments for this period', accomplishments, setAccomplishments, { multiline: true, placeholder: 'One item per line, or comma separated' })}
                  {field('Activities for next period', activitiesNextShift, setActivitiesNextShift, { multiline: true, placeholder: 'Describe upcoming activities…' })}
                  {field('Items you need your PM to do', pmActions, setPmActions, { multiline: true, placeholder: 'One action per line, or comma separated' })}
                  {field('Issues/actions to bring to the customer', issues, setIssues, { multiline: true, placeholder: 'One issue per line, or comma separated' })}
                </>
              ) : (
                <>
                  {field('Workers On Site', workersOnSite, setWorkersOnSite, { keyboardType: 'number-pad', autoCapitalize: 'none' })}
                  {field('Summary', summary, setSummary, { multiline: true, placeholder: 'High-level summary…' })}
                  {field('Accomplishments', accomplishments, setAccomplishments, { multiline: true, placeholder: 'What was completed today…' })}
                  {field('Items that need to be brought to FNS attention', itemsAttention, setItemsAttention, { multiline: true, placeholder: 'Anything FNS should know / follow up on…' })}
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
  textarea: { minHeight: 104, textAlignVertical: 'top' },
  hint: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 5 },
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
  pressed: { opacity: 0.72 },
});
