import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorHome, loadSubcontractorProjects } from '../api/subcontractorApi';

function initials(name) {
  return String(name || 'SC').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || 'SC';
}

export default function HomeScreen({ session, onLogout, onOpenProject }) {
  const [home, setHome] = useState(null);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const isPhone = width < 520;
  const isTablet = width >= 680;
  const columns = width >= 1000 ? 3 : isTablet ? 2 : 1;

  const user = home?.user || session?.user || {};
  const subtitle = user?.subcontractor_name || user?.name || user?.email_address || 'Subcontractor';

  const load = useCallback(async (nextQuery = query, showRefresh = false) => {
    setError('');
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [homeData, projectData] = await Promise.all([
        loadSubcontractorHome(session.portalUrl, session.access_token),
        loadSubcontractorProjects(session.portalUrl, session.access_token, nextQuery),
      ]);
      setHome(homeData);
      setProjects(projectData?.projects || []);
    } catch (err) {
      setError(err?.message || 'Could not load subcontractor projects.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, session?.portalUrl, session?.access_token]);

  useEffect(() => { load('', false); }, []);

  const content = useMemo(() => {
    if (loading) {
      return <View style={styles.loading}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Loading projects…</Text></View>;
    }
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(query, true)} />}
      >
        <View style={[styles.hero, isPhone && styles.heroPhone]}>
          <View style={[styles.avatar, isPhone && styles.avatarPhone]}><Text style={[styles.avatarText, isPhone && styles.avatarTextPhone]}>{initials(user?.name || user?.subcontractor_name)}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.heroTitle, isPhone && styles.heroTitlePhone]}>Projects Under Construction</Text>
            {!isPhone ? <Text style={styles.heroCopy}>Active assigned construction projects are shown below.</Text> : null}
          </View>
          <View style={[styles.countPill, isPhone && styles.countPillPhone]}><Text style={[styles.countText, isPhone && styles.countTextPhone]}>{projects.length}</Text></View>
        </View>

        {!!error && <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View>}

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query, false)}
            placeholder="Search projects"
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
            returnKeyType="search"
          />
          <Pressable style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]} onPress={() => load(query, false)}>
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {!projects.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active projects found</Text>
            <Text style={styles.emptyCopy}>This account is not currently assigned to any active under-construction projects, or the search did not match any projects.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {projects.map((project) => (
              <Pressable
                key={project.site_name}
                style={({ pressed }) => [styles.projectCard, { width: `${100 / columns}%` }, pressed && styles.pressed]}
                onPress={() => onOpenProject(project, home?.pages || [])}
              >
                <View style={styles.innerProjectCard}>
                  <View style={styles.projectTopRow}>
                    <View style={styles.projectIcon}><Text style={styles.projectIconText}>🏗️</Text></View>
                    <View style={styles.statusPill}><Text style={styles.statusText}>Active</Text></View>
                  </View>
                  <Text style={styles.projectName} numberOfLines={2}>{project.site_name}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }, [loading, refreshing, query, projects, columns, user, home, load, onOpenProject, error, isPhone]);

  return (
    <ScreenShell title="FNS Subcontractor Portal" subtitle={subtitle} onLogout={onLogout}>
      {content}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.muted, fontWeight: '800' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#10233f', borderRadius: 22, paddingHorizontal: 15, paddingVertical: 15, marginBottom: 14, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  heroPhone: { gap: 9, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  avatar: { width: 50, height: 50, borderRadius: 18, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  avatarPhone: { width: 36, height: 36, borderRadius: 13 },
  avatarText: { color: colors.blue, fontWeight: '900', fontSize: 17 },
  avatarTextPhone: { fontSize: 14 },
  heroTitle: { color: '#fff', fontSize: 21, lineHeight: 25, fontWeight: '900' },
  heroTitlePhone: { fontSize: 15, lineHeight: 19 },
  heroCopy: { color: '#b9c8dc', lineHeight: 19, marginTop: 3, fontWeight: '700' },
  countPill: { minWidth: 44, height: 44, borderRadius: 16, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bbf7d0' },
  countPillPhone: { minWidth: 34, height: 34, borderRadius: 13 },
  countText: { color: colors.green, fontWeight: '900', fontSize: 18 },
  countTextPhone: { fontSize: 14 },
  errorCard: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14 },
  errorText: { color: '#b91c1c', fontWeight: '800', textAlign: 'center' },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12, fontWeight: '800', color: colors.text },
  searchButton: { backgroundColor: colors.blue, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#1d4ed8', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  searchButtonText: { color: '#fff', fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  projectCard: { padding: 6 },
  innerProjectCard: { minHeight: 108, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 14, justifyContent: 'space-between', shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  projectTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  projectIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  projectIconText: { fontSize: 20 },
  statusPill: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { color: colors.green, fontWeight: '900', fontSize: 11 },
  projectName: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '900', marginTop: 12 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 20 },
  emptyTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  emptyCopy: { color: colors.muted, fontWeight: '600', lineHeight: 20, marginTop: 8 },
  pressed: { opacity: 0.72 },
});
